import { randomUUID } from 'node:crypto'
import {
  CLIENT_EVENT,
  DEFAULT_FIND_ME_CONFIG,
  SERVER_EVENT,
  type HelloAck,
  type MatchConfirmedPayload,
  type PairAssignedPayload,
  type PairEndedPayload,
  type StatePayload,
} from '@comatch/core'
import { and, eq, inArray } from 'drizzle-orm'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { events, games, pairs, participants, signals } from '../db/schema.js'
import { createSessionToken, hashToken } from '../lib/crypto.js'
import { startServer, type RunningServer } from '../server.js'
import { computeGameRunStats, listParticipants } from './stats.js'

/**
 * Ende-zu-Ende über echte Socket-Verbindungen gegen echtes Postgres.
 *
 * Das ist die Absicherung, die sich mit Attrappen nicht ersetzen lässt: Ob eine
 * Codeauswahl als Match durchgeht, hängt an Zustandsübergängen, an der Sicht jeder
 * Seite auf das Paar und am Wettrennen zweier gleichzeitiger Anfragen — alles Dinge,
 * die erst im Zusammenspiel auftreten.
 *
 * Braucht ein laufendes Postgres: `npm run db:up && npm run db:migrate`.
 */

let server: RunningServer
const createdEventIds: string[] = []
const openSockets: Socket[] = []

beforeAll(async () => {
  server = await startServer({ port: 0 })
}, 30_000)

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.disconnect()
})

afterAll(async () => {
  for (const socket of openSockets.splice(0)) socket.disconnect()
  if (createdEventIds.length > 0) {
    await db.delete(events).where(inArray(events.id, createdEventIds))
  }
  await server?.close()
  await closeDatabase()
}, 30_000)

/* ------------------------------------------------------------------ Helfer */

async function createEvent(): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({ slug: `test-${randomUUID().slice(0, 8)}`, name: 'Integrationstest' })
    .returning()
  createdEventIds.push(row!.id)
  return row!.id
}

/** Teilnehmer mit Foto und im Pool — das Onboarding ist hier nicht der Prüfgegenstand. */
async function createParticipant(eventId: string, name: string): Promise<string> {
  const token = createSessionToken()
  await db.insert(participants).values({
    eventId,
    displayName: name,
    photoKey: `test/${randomUUID()}.webp`,
    sessionTokenHash: hashToken(token),
    state: 'waiting',
  })
  return token
}

async function startGame(eventId: string, config = {}): Promise<string> {
  const [row] = await db
    .insert(games)
    .values({
      eventId,
      type: 'find_me',
      state: 'running',
      config: { ...DEFAULT_FIND_ME_CONFIG, ...config },
      startedAt: new Date(),
    })
    .returning()
  return row!.id
}

function connect(token: string): Promise<{ socket: Socket; ack: HelloAck }> {
  return new Promise((resolve, reject) => {
    const socket = connectClient(`http://localhost:${server.port}`, {
      transports: ['websocket'],
      forceNew: true,
    })
    openSockets.push(socket)

    const timer = setTimeout(() => reject(new Error('Verbindung kam nicht zustande')), 10_000)

    socket.on('connect', () => {
      socket.emit(CLIENT_EVENT.hello, { sessionToken: token }, (ack: HelloAck) => {
        clearTimeout(timer)
        if (!ack.ok) reject(new Error(`hello abgelehnt: ${JSON.stringify(ack)}`))
        else resolve({ socket, ack })
      })
    })
    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Auf "${event}" kam nichts innerhalb von ${timeoutMs} ms`)),
      timeoutMs,
    )
    socket.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

/** Erfolgreich, wenn das Ereignis **nicht** eintrifft. */
function expectSilence(socket: Socket, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = (payload: unknown) =>
      reject(new Error(`"${event}" kam unerwartet: ${JSON.stringify(payload)}`))
    socket.once(event, onEvent)
    setTimeout(() => {
      socket.off(event, onEvent)
      resolve()
    }, ms)
  })
}

/** Wartet auf den ersten Zustand, der die Bedingung erfüllt — frühere gehen vorbei. */
function waitForState(
  socket: Socket,
  predicate: (state: StatePayload) => boolean,
  timeoutMs = 8_000,
): Promise<StatePayload> {
  return new Promise((resolve, reject) => {
    const onState = (state: StatePayload) => {
      if (!predicate(state)) return
      clearTimeout(timer)
      socket.off(SERVER_EVENT.state, onState)
      resolve(state)
    }
    const timer = setTimeout(() => {
      socket.off(SERVER_EVENT.state, onState)
      reject(new Error(`Kein passender Zustand innerhalb von ${timeoutMs} ms`))
    }, timeoutMs)
    socket.on(SERVER_EVENT.state, onState)
  })
}

function shownCode(state: StatePayload): string | null {
  const confirmation = state.pair?.confirmation
  return confirmation?.role === 'show' ? confirmation.code : null
}

function offeredChoices(state: StatePayload): string[] | null {
  const confirmation = state.pair?.confirmation
  return confirmation?.role === 'choose' ? confirmation.choices : null
}

/** `requester` tippt „Wir haben uns gefunden“ — liefert seinen Code und die Vorschläge des Gegenübers. */
async function requestCode(requester: Socket, chooser: Socket, pairId: string) {
  const shown = waitForState(requester, (state) => shownCode(state) !== null)
  const offered = waitForState(chooser, (state) => offeredChoices(state) !== null)
  requester.emit(CLIENT_EVENT.confirmRequest, { pairId })
  const [forRequester, forChooser] = await Promise.all([shown, offered])
  return { code: shownCode(forRequester)!, choices: offeredChoices(forChooser)! }
}

/** Zwei verbundene Teilnehmer, die der Matcher gerade einander zugewiesen hat. */
async function pairedDuo(config = {}) {
  const eventId = await createEvent()
  const [tokenA, tokenB] = await Promise.all([
    createParticipant(eventId, 'Anna'),
    createParticipant(eventId, 'Ben'),
  ])

  const [a, b] = await Promise.all([connect(tokenA!), connect(tokenB!)])

  const assigned = Promise.all([
    waitFor<PairAssignedPayload>(a.socket, SERVER_EVENT.pairAssigned),
    waitFor<PairAssignedPayload>(b.socket, SERVER_EVENT.pairAssigned),
  ])

  const gameId = await startGame(eventId, config)
  await server.engine.syncGame(gameId)

  const [assignedA, assignedB] = await assigned
  return { eventId, gameId, a, b, assignedA, assignedB }
}

/* ------------------------------------------------------------------- Tests */

describe('Find me, Ende zu Ende', () => {
  it('paart zwei wartende Teilnehmer und zeigt jedem das Foto des anderen', async () => {
    const { a, b, assignedA, assignedB } = await pairedDuo()

    expect(assignedA.pair.id).toBe(assignedB.pair.id)
    expect(assignedA.pair.partner.displayName).toBe('Ben')
    expect(assignedB.pair.partner.displayName).toBe('Anna')

    // Während der Suche gibt es nur Foto und Vorname — kein Profil.
    expect(assignedA.pair.partner).not.toHaveProperty('profile')
    expect(assignedA.pair.partner.photoUrl).toBeTruthy()
    expect(assignedA.pair.expiresAt).toBeGreaterThan(Date.now())

    expect(a.ack.participant.displayName).toBe('Anna')
    expect(b.ack.participant.displayName).toBe('Ben')
  }, 30_000)

  it('zeigt dem Auslöser seinen Code und dem Gegenüber drei Vorschläge', async () => {
    const { a, b, assignedA } = await pairedDuo()
    expect(assignedA.pair.confirmation).toBeNull()

    const { code, choices } = await requestCode(a.socket, b.socket, assignedA.pair.id)

    expect(code).toMatch(/^[A-Z][a-z]+ [1-9]\d$/)
    expect(choices).toHaveLength(3)
    expect(choices.filter((choice) => choice === code)).toHaveLength(1)

    // Die falschen Vorschläge gehören niemandem im Event — auch nicht dem Gegenüber selbst.
    const people = await db
      .select({ code: participants.confirmCode })
      .from(participants)
      .where(inArray(participants.id, [a.ack.participant.id, b.ack.participant.id]))
    const taken = new Set(people.map((row) => row.code))
    expect(choices.filter((choice) => taken.has(choice))).toEqual([code])
  }, 30_000)

  it('zählt den Match, wenn das Gegenüber den richtigen Code wählt', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const { code } = await requestCode(a.socket, b.socket, pairId)

    const confirmed = Promise.all([
      waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed),
      waitFor<MatchConfirmedPayload>(b.socket, SERVER_EVENT.matchConfirmed),
    ])
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code })
    const [forA, forB] = await confirmed

    expect(forA.pairId).toBe(pairId)
    expect(forA.via).toBe('code')
    expect(forA.totalMatches).toBe(1)
    expect(forB.totalMatches).toBe(1)

    // Erst jetzt wird das Profil des Gegenübers sichtbar.
    expect(forA.partner).toHaveProperty('profile')
    expect(forA.partner.displayName).toBe('Ben')
    expect(forB.partner.displayName).toBe('Anna')

    const [row] = await db.select().from(pairs).where(eq(pairs.id, pairId))
    expect(row?.state).toBe('confirmed')
    expect(row?.via).toBe('code')
  }, 30_000)

  it('schreibt den Match beiden Teilnehmern gut', async () => {
    /*
     * Eigener Test, weil sich hier schon einmal ein stiller Fehler versteckt hat:
     * Die Gesamtzahl stimmte, die Zahl je Person war null. Ein Query-Builder, der
     * einen Spaltenverweis unqualifiziert rendert, wirft keinen Fehler — er
     * antwortet nur falsch.
     */
    const { eventId, a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const { code } = await requestCode(a.socket, b.socket, pairId)
    const confirmed = waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed)
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code })
    await confirmed

    const rows = await listParticipants(db, eventId)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.matchCount)).toEqual([1, 1])

    const runs = [...(await computeGameRunStats(db, eventId)).values()]
    expect(runs).toHaveLength(1)
    expect(runs[0]!.matchesConfirmed).toBe(1)
    expect(runs[0]!.codeMissRatio).toBe(0)
    expect(runs[0]!.medianTimeToMatchMs).not.toBeNull()
  }, 30_000)

  it('setzt die Bestätigung nach einem falschen Code zurück und zählt den Fehlgriff', async () => {
    /*
     * Zurücksetzen statt weiterwählen lassen: Sonst käme man mit drei Tipps auch
     * ohne Blick auf das andere Handy ans Ziel.
     */
    const { eventId, a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const { code, choices } = await requestCode(a.socket, b.socket, pairId)
    const wrong = choices.find((choice) => choice !== code)!

    const resetForA = waitForState(a.socket, (state) => state.pair?.codeMisses === 1)
    const resetForB = waitForState(b.socket, (state) => state.pair?.codeMisses === 1)
    const noMatch = expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 1_500)
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code: wrong })

    const [stateA, stateB] = await Promise.all([resetForA, resetForB])
    await noMatch
    expect(stateA.pair?.confirmation).toBeNull()
    expect(stateB.pair?.confirmation).toBeNull()

    const recorded = await db.select().from(signals).where(eq(signals.pairId, pairId))
    expect(recorded.map((signal) => [signal.kind, signal.matched])).toEqual([['code', false]])

    // Der zweite Anlauf klappt — und die Auswertung kennt beide Versuche.
    const retry = await requestCode(b.socket, a.socket, pairId)
    const confirmed = waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed)
    a.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code: retry.code })
    await confirmed

    const runs = [...(await computeGameRunStats(db, eventId)).values()]
    expect(runs[0]!.codeMissRatio).toBe(0.5)
  }, 30_000)

  it('lässt den Auslöser nicht seinen eigenen Code auswählen', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const { code } = await requestCode(a.socket, b.socket, pairId)
    a.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code })

    await expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 1_500)
    const [row] = await db.select().from(pairs).where(eq(pairs.id, pairId))
    expect(row?.state).toBe('pending')
  }, 30_000)

  it('nimmt keinen Code an, der nicht zur Auswahl stand', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    await requestCode(a.socket, b.socket, pairId)
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code: 'Tango 100' })

    await expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 1_500)
    const [row] = await db.select().from(pairs).where(eq(pairs.id, pairId))
    expect(row?.state).toBe('pending')
    expect(row?.codeMisses).toBe(0)
  }, 30_000)

  it('zählt einen Match auch bei doppeltem Tipp nur einmal', async () => {
    // Das Wettrennen: Beide Anfragen finden den richtigen Code. Nur die bedingte
    // Aktualisierung in der Datenbank verhindert den doppelten Zähler.
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const { code } = await requestCode(a.socket, b.socket, pairId)

    const received: MatchConfirmedPayload[] = []
    a.socket.on(SERVER_EVENT.matchConfirmed, (payload: MatchConfirmedPayload) =>
      received.push(payload),
    )
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code })
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code })

    await new Promise((resolve) => setTimeout(resolve, 2_000))

    expect(received).toHaveLength(1)
    expect(received[0]?.totalMatches).toBe(1)
  }, 30_000)

  it('macht beim gleichzeitigen Tippen genau einen zum Auslöser', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const settled = Promise.all([
      waitForState(a.socket, (state) => state.pair?.confirmation != null),
      waitForState(b.socket, (state) => state.pair?.confirmation != null),
    ])
    a.socket.emit(CLIENT_EVENT.confirmRequest, { pairId })
    b.socket.emit(CLIENT_EVENT.confirmRequest, { pairId })

    const roles = (await settled).map((state) => state.pair?.confirmation?.role).sort()
    expect(roles).toEqual(['choose', 'show'])
  }, 30_000)

  it('schickt beide zurück in den Pool, wenn jemand abbricht', async () => {
    const { a, b, assignedA } = await pairedDuo()

    const ended = Promise.all([
      waitFor<PairEndedPayload>(a.socket, SERVER_EVENT.pairEnded),
      waitFor<PairEndedPayload>(b.socket, SERVER_EVENT.pairEnded),
    ])

    a.socket.emit(CLIENT_EVENT.pairCancel, { pairId: assignedA.pair.id })

    const [forA, forB] = await ended
    expect(forA.reason).toBe('cancelled')
    expect(forB.reason).toBe('cancelled')

    const [row] = await db.select().from(pairs).where(eq(pairs.id, assignedA.pair.id))
    expect(row?.state).toBe('cancelled')
  }, 30_000)

  it('löst das Paar auf, wenn der Partner verschwindet', async () => {
    const { a, b } = await pairedDuo()

    const ended = waitFor<PairEndedPayload>(a.socket, SERVER_EVENT.pairEnded, 30_000)
    b.socket.disconnect()

    // Der Sweeper greift erst nach Ablauf der Heartbeat-Kulanz — genau so soll es
    // sein, damit ein kurzer Netzwechsel niemanden aus dem Spiel wirft.
    expect((await ended).reason).toBe('partner_left')
  }, 45_000)

  it('nimmt keine Bestätigung von jemandem an, der nicht zum Paar gehört', async () => {
    const { eventId, assignedA } = await pairedDuo()

    const outsiderToken = await createParticipant(eventId, 'Fremde')
    const outsider = await connect(outsiderToken)
    outsider.socket.emit(CLIENT_EVENT.confirmRequest, { pairId: assignedA.pair.id })

    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const [row] = await db.select().from(pairs).where(eq(pairs.id, assignedA.pair.id))
    expect(row?.codeRequestedBy).toBeNull()
  }, 30_000)

  it('vergibt beim Beitritt einen Aktivierungscode', async () => {
    const eventId = await createEvent()
    const [event] = await db.select().from(events).where(eq(events.id, eventId))

    const response = await fetch(
      `http://localhost:${server.port}/api/events/${event!.slug}/participants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Neu' }),
      },
    )
    expect(response.status).toBe(201)
    const { participant } = (await response.json()) as { participant: { id: string } }

    const [row] = await db.select().from(participants).where(eq(participants.id, participant.id))
    expect(row?.confirmCode).toMatch(/^[A-Z][a-z]+ [1-9]\d$/)
  }, 30_000)

  it('nennt schon in der Begrüßung den nächsten Takt', async () => {
    /*
     * Sonst hätte ein gerade verbundener Teilnehmer bis zum nächsten Takt keinen
     * Countdown — also genau in der Spanne, in der er am ehesten wissen will, wie
     * lange es noch dauert.
     */
    const eventId = await createEvent()
    const token = await createParticipant(eventId, 'Neuankömmling')

    const gameId = await startGame(eventId)
    await server.engine.syncGame(gameId)

    const { ack } = await connect(token)

    expect(ack.nextTickAt).not.toBeNull()
    expect(ack.nextTickAt! - ack.serverTime).toBeGreaterThan(0)
    expect(ack.nextTickAt! - ack.serverTime).toBeLessThanOrEqual(
      DEFAULT_FIND_ME_CONFIG.tickIntervalMs,
    )
  }, 30_000)

  it('lässt einen nach dem Match nicht still aus dem Pool fallen', async () => {
    /*
     * Nach einem bestätigten Match steht man auf `matched` — und der Matcher greift
     * nur `waiting` auf. Wer die Seite jetzt neu lädt, muss aktiv zurück in den Pool
     * geholt werden; die Oberfläche zeigt dafür „Wieder mitmachen".
     */
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const { code } = await requestCode(a.socket, b.socket, pairId)
    const confirmed = waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed)
    b.socket.emit(CLIENT_EVENT.confirmChoose, { pairId, code })
    await confirmed

    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, assignedA.pair.partner.id))
    expect(row?.state).toBe('matched')

    // „Weiter suchen" bringt zurück in den Pool.
    b.socket.emit(CLIENT_EVENT.queueJoin)
    await new Promise((resolve) => setTimeout(resolve, 800))

    const [after] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, assignedA.pair.partner.id))
    expect(after?.state).toBe('waiting')
  }, 30_000)

  it('holt vor einem neuen Spiel alle Teilnehmer mit Match zurück in den Pool', async () => {
    /*
     * Zwischen zwei Spielläufen sitzen die meisten in `matched` oder `idle` — der
     * Matcher nimmt aber nur `waiting`. Ohne den Reset beim Start begänne Runde
     * zwei mit leerem Pool, obwohl der Saal voll ist. `offline` bleibt unberührt:
     * Wer weg ist, soll nicht als wartend gezählt werden.
     */
    const eventId = await createEvent()
    await Promise.all([
      createParticipant(eventId, 'Marta'),
      createParticipant(eventId, 'Ines'),
      createParticipant(eventId, 'Olaf'),
    ])
    await db
      .update(participants)
      .set({ state: 'matched' })
      .where(and(eq(participants.eventId, eventId), eq(participants.displayName, 'Marta')))
    await db
      .update(participants)
      .set({ state: 'idle' })
      .where(and(eq(participants.eventId, eventId), eq(participants.displayName, 'Ines')))
    await db
      .update(participants)
      .set({ state: 'offline' })
      .where(and(eq(participants.eventId, eventId), eq(participants.displayName, 'Olaf')))

    await server.engine.resetPoolForNewGame(eventId)

    const rows = await db
      .select({ name: participants.displayName, state: participants.state })
      .from(participants)
      .where(eq(participants.eventId, eventId))
    const byName = new Map(rows.map((row) => [row.name, row.state]))
    expect(byName.get('Marta')).toBe('waiting')
    expect(byName.get('Ines')).toBe('waiting')
    expect(byName.get('Olaf')).toBe('offline')
  }, 30_000)

  it('beantwortet den Uhrenabgleich mit der Serverzeit', async () => {
    const eventId = await createEvent()
    const token = await createParticipant(eventId, 'Uhr')
    const { socket } = await connect(token)

    const c0 = Date.now()
    const pong = waitFor<{ c0: number; s: number }>(socket, SERVER_EVENT.clockPong)
    socket.emit(CLIENT_EVENT.clockPing, { c0 })

    const result = await pong
    expect(result.c0).toBe(c0)
    expect(Math.abs(result.s - Date.now())).toBeLessThan(5_000)
  }, 30_000)
})
