import { SERVER_EVENT, type PairEndReason, type StatePayload } from '@comatch/core'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '../db/index.js'
import { games, pairs, participants, type GameRow, type ParticipantRow } from '../db/schema.js'
import { presence } from '../lib/presence.js'
import type { Hub } from '../realtime/hub.js'
import { partnerIdOf, toActivePair, toGame, toParticipant } from '../serialize.js'
import { buildPairs, pairKey } from './matcher.js'

/** Wie oft nach Teilnehmern gesucht wird, deren Heartbeat ausgeblieben ist. */
const PRESENCE_SWEEP_INTERVAL_MS = 5_000

export interface GameEngine {
  /** Nach einem Serverneustart die laufenden Spiele wieder in Takt bringen. */
  resume(): Promise<void>
  shutdown(): void
  /** Nach einem Zustandswechsel durch den Admin den Takt nachziehen. */
  syncGame(gameId: string): Promise<void>
  /** Einen Takt sofort auslösen — für Tests und den Sofort-Start eines Spiels. */
  tickNow(gameId: string): Promise<void>
  nextTickAt(gameId: string): number | null
  handleOffline(participantId: string): Promise<void>
  cancelPair(participantId: string, pairId: string): Promise<void>
  setQueued(participantId: string, queued: boolean): Promise<void>
  pushState(participantId: string): Promise<void>
  buildStatePayload(participantId: string): Promise<StatePayload | null>
}

/** Nach dem Commit zu verschickende Nachricht — nie aus einer Transaktion heraus senden. */
type Notification =
  | { to: string; kind: 'pairAssigned'; pairId: string }
  | { to: string; kind: 'pairEnded'; pairId: string; reason: PairEndReason }
  | { to: string; kind: 'state' }

export function createGameEngine(deps: {
  db: Database
  hub: Hub
  log: FastifyBaseLogger
}): GameEngine {
  const { db, hub, log } = deps

  const timers = new Map<string, NodeJS.Timeout>()
  const nextTick = new Map<string, number>()
  let sweeper: NodeJS.Timeout | null = null

  /* ------------------------------------------------------------- Versand */

  /**
   * Verschickt die gesammelten Nachrichten.
   *
   * Die Paar- und Teilnehmerzeilen werden gebündelt geladen: Bei 100 Paaren wären
   * es sonst 400 Einzelabfragen — alle zehn Sekunden, auf dem heißesten Pfad der App.
   */
  async function flush(notifications: readonly Notification[]): Promise<void> {
    if (notifications.length === 0) return

    const assignedPairIds = [
      ...new Set(
        notifications.filter((note) => note.kind === 'pairAssigned').map((note) => note.pairId),
      ),
    ]

    const pairRows = assignedPairIds.length
      ? await db.select().from(pairs).where(inArray(pairs.id, assignedPairIds))
      : []
    const pairById = new Map(pairRows.map((pair) => [pair.id, pair]))

    const personIds = [...new Set(pairRows.flatMap((pair) => [pair.aId, pair.bId]))]
    const personRows = personIds.length
      ? await db.select().from(participants).where(inArray(participants.id, personIds))
      : []
    const personById = new Map<string, ParticipantRow>(personRows.map((row) => [row.id, row]))

    for (const note of notifications) {
      try {
        if (note.kind === 'state') {
          await pushState(note.to)
          continue
        }

        if (note.kind === 'pairEnded') {
          hub.toParticipant(note.to, SERVER_EVENT.pairEnded, {
            pairId: note.pairId,
            reason: note.reason,
          })
          await pushState(note.to)
          continue
        }

        const pair = pairById.get(note.pairId)
        const partner = pair ? personById.get(partnerIdOf(pair, note.to)) : undefined
        if (!pair || !partner) continue

        hub.toParticipant(note.to, SERVER_EVENT.pairAssigned, {
          pair: await toActivePair(pair, partner),
          serverTime: Date.now(),
        })
      } catch (error) {
        // Ein fehlgeschlagener Versand darf den Takt der anderen nicht aufhalten.
        log.error({ error, note }, 'Benachrichtigung konnte nicht zugestellt werden')
      }
    }
  }

  async function buildStatePayload(participantId: string): Promise<StatePayload | null> {
    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1)
    if (!row || row.deletedAt) return null

    const [game] = await db
      .select()
      .from(games)
      .where(and(eq(games.eventId, row.eventId), inArray(games.state, ['running', 'paused'])))
      .limit(1)

    const [pair] = game
      ? await db
          .select()
          .from(pairs)
          .where(
            and(
              eq(pairs.gameId, game.id),
              eq(pairs.state, 'pending'),
              sql`${participantId} in (${pairs.aId}, ${pairs.bId})`,
            ),
          )
          .limit(1)
      : []

    let activePair = null
    if (pair) {
      const [partner] = await db
        .select()
        .from(participants)
        .where(eq(participants.id, partnerIdOf(pair, participantId)))
        .limit(1)
      if (partner) activePair = await toActivePair(pair, partner)
    }

    return {
      participant: await toParticipant(row),
      game: game ? toGame(game) : null,
      pair: activePair,
      serverTime: Date.now(),
      nextTickAt: game ? (nextTick.get(game.id) ?? null) : null,
    }
  }

  async function pushState(participantId: string): Promise<void> {
    const payload = await buildStatePayload(participantId)
    if (payload) hub.toParticipant(participantId, SERVER_EVENT.state, payload)
  }

  /* --------------------------------------------------------- Paar beenden */

  /**
   * Löst offene Paare auf und schickt beide Seiten zurück in den Pool.
   *
   * Beide Aktualisierungen sind bedingt: Ein Paar, das im selben Moment bestätigt
   * wurde, darf nicht nachträglich wieder aufgerissen werden, und wer schon wieder
   * `waiting` ist, wird nicht erneut angefasst. Dadurch ist der Aufruf gefahrlos
   * wiederholbar — Takt, Abbruch und Verbindungsabbruch können sich überlappen.
   */
  async function endPairs(
    pairIds: readonly string[],
    reason: PairEndReason,
  ): Promise<Notification[]> {
    if (pairIds.length === 0) return []

    const ended = await db
      .update(pairs)
      .set({ state: reason === 'expired' ? 'expired' : 'cancelled', endReason: reason })
      .where(and(inArray(pairs.id, [...pairIds]), eq(pairs.state, 'pending')))
      .returning()

    if (ended.length === 0) return []

    await db
      .update(participants)
      .set({ state: 'waiting' })
      .where(
        and(
          inArray(
            participants.id,
            ended.flatMap((pair) => [pair.aId, pair.bId]),
          ),
          eq(participants.state, 'searching'),
        ),
      )

    return ended.flatMap((pair): Notification[] => [
      { to: pair.aId, kind: 'pairEnded', pairId: pair.id, reason },
      { to: pair.bId, kind: 'pairEnded', pairId: pair.id, reason },
    ])
  }

  async function pendingPairsOf(participantId: string): Promise<string[]> {
    const rows = await db
      .select({ id: pairs.id })
      .from(pairs)
      .where(
        and(eq(pairs.state, 'pending'), sql`${participantId} in (${pairs.aId}, ${pairs.bId})`),
      )
    return rows.map((row) => row.id)
  }

  /* ---------------------------------------------------------------- Takt */

  async function tick(gameId: string): Promise<void> {
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1)
    if (!game || game.state !== 'running') {
      clearTimer(gameId)
      return
    }

    // Abgelaufene Paare zuerst, außerhalb der Transaktion: Der Schritt ist durch
    // die Bedingung auf `pending` von sich aus wiederholbar und braucht die
    // Serialisierung des Locks nicht.
    const overdue = await db
      .select({ id: pairs.id })
      .from(pairs)
      .where(
        and(
          eq(pairs.gameId, game.id),
          eq(pairs.state, 'pending'),
          lt(pairs.expiresAt, new Date()),
        ),
      )
    const notifications = await endPairs(
      overdue.map((row) => row.id),
      'expired',
    )

    notifications.push(...(await assignPairs(game)))
    await flush(notifications)
  }

  /** Der eigentliche Paarungsschritt — vollständig in einer Transaktion. */
  async function assignPairs(game: GameRow): Promise<Notification[]> {
    return db.transaction(async (tx): Promise<Notification[]> => {
      /*
       * Der Takt läuft im Serverprozess. Sollte der Dienst je auf mehrere Instanzen
       * skaliert werden, würde jede für sich ticken und Teilnehmer doppelt paaren.
       * Der Transaktions-Lock verhindert das schon jetzt — er kostet praktisch nichts
       * und macht das spätere Hochskalieren zu einer Konfigurationsfrage statt zu
       * einem stillen Datenfehler. Er endet automatisch mit der Transaktion.
       */
      const lock = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtext(${game.id})) as ok`,
      )) as unknown as Array<{ ok: boolean }>
      if (!lock[0]?.ok) return []

      // Kandidaten: wartend, nicht gelöscht — und tatsächlich noch am Gerät.
      const waiting = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.eventId, game.eventId),
            eq(participants.state, 'waiting'),
            isNull(participants.deletedAt),
          ),
        )
      const candidates = waiting.map((row) => row.id).filter((id) => presence.isOnline(id))
      if (candidates.length < 2) return []

      // Wer hatte wen schon? Über das ganze Event, nicht nur über dieses Spiel —
      // ein neu gestartetes Spiel soll die Begegnungen nicht vergessen.
      const history = await tx
        .select({ aId: pairs.aId, bId: pairs.bId })
        .from(pairs)
        .where(and(eq(pairs.eventId, game.eventId), eq(pairs.state, 'confirmed')))
      const seen = new Set(history.map((row) => pairKey(row.aId, row.bId)))

      const { pairs: fresh, unpaired } = buildPairs(candidates, seen)
      if (fresh.length === 0) return []

      const expiresAt = new Date(Date.now() + game.config.pairTimeoutMs)
      const created = await tx
        .insert(pairs)
        .values(
          fresh.map(([aId, bId]) => ({
            gameId: game.id,
            eventId: game.eventId,
            aId,
            bId,
            expiresAt,
          })),
        )
        .returning()

      await tx
        .update(participants)
        .set({ state: 'searching' })
        .where(inArray(participants.id, fresh.flat()))

      const notes: Notification[] = created.flatMap((pair): Notification[] => [
        { to: pair.aId, kind: 'pairAssigned', pairId: pair.id },
        { to: pair.bId, kind: 'pairAssigned', pairId: pair.id },
      ])
      // Wer übrig bleibt, braucht einen frischen Countdown auf den nächsten Takt.
      for (const id of unpaired) notes.push({ to: id, kind: 'state' })

      return notes
    })
  }

  function scheduleTicks(game: GameRow): void {
    clearTimer(game.id)
    const interval = game.config.tickIntervalMs
    nextTick.set(game.id, Date.now() + interval)

    timers.set(
      game.id,
      setInterval(() => {
        nextTick.set(game.id, Date.now() + interval)
        void tick(game.id).catch((error) =>
          log.error({ error, gameId: game.id }, 'Takt fehlgeschlagen'),
        )
      }, interval),
    )
  }

  function clearTimer(gameId: string): void {
    const timer = timers.get(gameId)
    if (timer) clearInterval(timer)
    timers.delete(gameId)
    nextTick.delete(gameId)
  }

  /* ---------------------------------------------------------- Öffentlich */

  async function syncGame(gameId: string): Promise<void> {
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1)
    if (!game) {
      clearTimer(gameId)
      return
    }

    if (game.state === 'running') {
      scheduleTicks(game)
      // Nicht erst nach zehn Sekunden loslegen — beim Start sollen die ersten Paare
      // sofort stehen, sonst wirkt das Spiel vor Publikum kaputt.
      await tick(game.id)
    } else {
      clearTimer(gameId)
      const open = await db
        .select({ id: pairs.id })
        .from(pairs)
        .where(and(eq(pairs.gameId, gameId), eq(pairs.state, 'pending')))
      await flush(
        await endPairs(
          open.map((row) => row.id),
          'game_stopped',
        ),
      )
    }

    hub.toEvent(game.eventId, SERVER_EVENT.gameChanged, {
      game: game.state === 'ended' ? null : toGame(game),
    })
  }

  async function handleOffline(participantId: string): Promise<void> {
    await db
      .update(participants)
      .set({ state: 'offline', lastSeenAt: new Date() })
      .where(
        and(
          eq(participants.id, participantId),
          inArray(participants.state, ['waiting', 'searching']),
        ),
      )

    await flush(await endPairs(await pendingPairsOf(participantId), 'partner_left'))
  }

  async function cancelPair(participantId: string, pairId: string): Promise<void> {
    const [pair] = await db.select().from(pairs).where(eq(pairs.id, pairId)).limit(1)
    if (!pair) return
    if (pair.aId !== participantId && pair.bId !== participantId) return

    await flush(await endPairs([pairId], 'cancelled'))
  }

  async function setQueued(participantId: string, queued: boolean): Promise<void> {
    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1)
    if (!row || row.deletedAt) return

    // Aus einer laufenden Suche heraus muss erst das Paar aufgelöst werden.
    if (row.state === 'searching') {
      await flush(await endPairs(await pendingPairsOf(participantId), 'cancelled'))
    }

    // Ohne Foto geht es nicht weiter — das Foto ist das Spiel.
    const target = queued ? (row.photoKey ? 'waiting' : 'onboarding') : 'idle'
    await db.update(participants).set({ state: target }).where(eq(participants.id, participantId))
    await pushState(participantId)
  }

  async function resume(): Promise<void> {
    const running = await db.select().from(games).where(eq(games.state, 'running'))
    for (const game of running) {
      log.info({ gameId: game.id }, 'Laufendes Spiel wieder aufgenommen')
      scheduleTicks(game)
    }

    sweeper = setInterval(() => {
      for (const { participantId } of presence.prune()) {
        void handleOffline(participantId).catch((error) =>
          log.error({ error, participantId }, 'Offline-Behandlung fehlgeschlagen'),
        )
      }
    }, PRESENCE_SWEEP_INTERVAL_MS)
  }

  function shutdown(): void {
    for (const gameId of [...timers.keys()]) clearTimer(gameId)
    if (sweeper) clearInterval(sweeper)
    sweeper = null
  }

  return {
    resume,
    shutdown,
    syncGame,
    tickNow: tick,
    nextTickAt: (gameId) => nextTick.get(gameId) ?? null,
    handleOffline,
    cancelPair,
    setQueued,
    pushState,
    buildStatePayload,
  }
}
