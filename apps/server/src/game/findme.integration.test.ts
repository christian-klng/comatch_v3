import { randomUUID } from 'node:crypto'
import {
  CLIENT_EVENT,
  DEFAULT_FIND_ME_CONFIG,
  SERVER_EVENT,
  type HelloAck,
  type MatchConfirmedPayload,
  type PairAssignedPayload,
  type PairEndedPayload,
} from '@comatch/core'
import { and, eq, inArray } from 'drizzle-orm'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { events, games, pairs, participants } from '../db/schema.js'
import { createSessionToken, hashToken } from '../lib/crypto.js'
import { startServer, type RunningServer } from '../server.js'
import { computeGameRunStats, listParticipants } from './stats.js'

/**
 * Ende-zu-Ende über echte Socket-Verbindungen gegen echtes Postgres.
 *
 * Das ist die Absicherung, die sich mit Attrappen nicht ersetzen lässt: Ob zwei
 * Stöße als ein Match durchgehen, hängt an Zeitfenster, Zustandsübergängen und dem
 * Wettrennen zweier gleichzeitiger Anfragen — alles Dinge, die erst im Zusammenspiel
 * auftreten.
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

  it('zählt den Match, wenn beide Stöße dicht beieinander liegen', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const confirmed = Promise.all([
      waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed),
      waitFor<MatchConfirmedPayload>(b.socket, SERVER_EVENT.matchConfirmed),
    ])

    /*
     * 400 ms Versatz — zwei Geräte mit unterschiedlicher Abtastrate liegen genau so.
     * Die Zeitstempel tragen bewusst Nachkommastellen: So kommen sie aus einem echten
     * Client, weil `performance.timeOrigin + event.timeStamp` Sub-Millisekunden
     * liefert und der Uhren-Offset aus einer Division durch zwei entsteht.
     */
    const now = Date.now() + 0.5
    a.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 22.4 })
    b.socket.emit(CLIENT_EVENT.bump, { pairId, t: now + 400.25, magnitude: 19.1 })

    const [forA, forB] = await confirmed

    expect(forA.pairId).toBe(pairId)
    expect(forA.via).toBe('bump')
    expect(forA.totalMatches).toBe(1)
    expect(forB.totalMatches).toBe(1)

    // Erst jetzt wird das Profil des Gegenübers sichtbar.
    expect(forA.partner).toHaveProperty('profile')
    expect(forA.partner.displayName).toBe('Ben')
    expect(forB.partner.displayName).toBe('Anna')

    const [row] = await db.select().from(pairs).where(eq(pairs.id, pairId))
    expect(row?.state).toBe('confirmed')
    expect(row?.via).toBe('bump')
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

    const confirmed = Promise.all([
      waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed),
      waitFor<MatchConfirmedPayload>(b.socket, SERVER_EVENT.matchConfirmed),
    ])

    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 20 })
    b.socket.emit(CLIENT_EVENT.bump, { pairId, t: now + 200, magnitude: 20 })
    await confirmed

    const rows = await listParticipants(db, eventId)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.matchCount)).toEqual([1, 1])

    const runs = [...(await computeGameRunStats(db, eventId)).values()]
    expect(runs).toHaveLength(1)
    expect(runs[0]!.matchesConfirmed).toBe(1)
    expect(runs[0]!.manualConfirmRatio).toBe(0)
    expect(runs[0]!.medianTimeToMatchMs).not.toBeNull()
  }, 30_000)

  it('zählt nichts, wenn die Stöße zu weit auseinanderliegen', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 22 })
    b.socket.emit(CLIENT_EVENT.bump, { pairId, t: now + 5_000, magnitude: 22 })

    await expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 2_000)

    const [row] = await db.select().from(pairs).where(eq(pairs.id, pairId))
    expect(row?.state).toBe('pending')
  }, 30_000)

  it('zählt nichts, wenn ein Stoß zu schwach war', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 22 })
    // Unter minBumpMagnitude — ein Wackler beim Gehen, kein Stoß.
    b.socket.emit(CLIENT_EVENT.bump, { pairId, t: now + 100, magnitude: 3 })

    await expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 2_000)
  }, 30_000)

  it('zählt einen Match auch dann nur einmal, wenn beide Stöße gleichzeitig eintreffen', async () => {
    // Das Wettrennen: Beide Handler finden das Gegenstück des anderen. Nur die
    // bedingte Aktualisierung in der Datenbank verhindert den doppelten Zähler.
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const received: MatchConfirmedPayload[] = []
    a.socket.on(SERVER_EVENT.matchConfirmed, (payload: MatchConfirmedPayload) =>
      received.push(payload),
    )

    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 20 })
    b.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 20 })

    await new Promise((resolve) => setTimeout(resolve, 2_500))

    expect(received).toHaveLength(1)
    expect(received[0]?.totalMatches).toBe(1)
  }, 30_000)

  it('bestätigt über die Rückfallebene, wenn der Sensor nicht mitspielt', async () => {
    const { a, b, assignedA } = await pairedDuo()
    const pairId = assignedA.pair.id

    const confirmed = waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed)

    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.manualConfirm, { pairId, t: now })
    b.socket.emit(CLIENT_EVENT.manualConfirm, { pairId, t: now + 3_000 })

    expect((await confirmed).via).toBe('manual')
  }, 30_000)

  it('lehnt die Rückfallebene ab, wenn der Admin sie abgeschaltet hat', async () => {
    const { a, b, assignedA } = await pairedDuo({ allowManualConfirm: false })
    const pairId = assignedA.pair.id

    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.manualConfirm, { pairId, t: now })
    b.socket.emit(CLIENT_EVENT.manualConfirm, { pairId, t: now + 500 })

    await expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 2_000)
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

  it('nimmt kein Signal von jemandem an, der nicht zum Paar gehört', async () => {
    const { eventId, a, assignedA } = await pairedDuo()

    const outsiderToken = await createParticipant(eventId, 'Fremde')
    const outsider = await connect(outsiderToken)

    outsider.socket.emit(CLIENT_EVENT.bump, {
      pairId: assignedA.pair.id,
      t: Date.now(),
      magnitude: 25,
    })
    a.socket.emit(CLIENT_EVENT.bump, { pairId: assignedA.pair.id, t: Date.now(), magnitude: 25 })

    await expectSilence(a.socket, SERVER_EVENT.matchConfirmed, 2_000)
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

    const confirmed = waitFor<MatchConfirmedPayload>(a.socket, SERVER_EVENT.matchConfirmed)
    const now = Date.now()
    a.socket.emit(CLIENT_EVENT.bump, { pairId, t: now, magnitude: 20 })
    b.socket.emit(CLIENT_EVENT.bump, { pairId, t: now + 150, magnitude: 20 })
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
