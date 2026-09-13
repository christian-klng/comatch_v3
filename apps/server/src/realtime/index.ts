import type { Server as HttpServer } from 'node:http'
import {
  CLIENT_EVENT,
  DEFAULT_EVENT_LOCALE,
  SERVER_EVENT,
  bumpPayloadSchema,
  clockPingPayloadSchema,
  helloPayloadSchema,
  manualConfirmPayloadSchema,
  pairCancelPayloadSchema,
  type ClientToServerEvents,
  type ErrorAck,
  type HelloAck,
  type ServerToClientEvents,
} from '@comatch/core'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { Server, type Socket } from 'socket.io'
import { db } from '../db/index.js'
import { events, participants } from '../db/schema.js'
import { env } from '../env.js'
import { recordSignal } from '../game/confirm.js'
import type { GameEngine } from '../game/engine.js'
import { loadMatches } from '../game/matches.js'
import { hashToken } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { presence } from '../lib/presence.js'
import { toParticipant } from '../serialize.js'
import { eventRoom, participantRoom, type Hub } from './hub.js'

interface SocketData {
  participantId?: string
  eventId?: string
  /** Zeitstempel der zuletzt gesendeten Signale, für die Drosselung. */
  signalTimes: number[]
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>

/**
 * Obergrenze für Bestätigungssignale je Socket. Ein echter Stoß erzeugt eines,
 * die Sperre im Detektor lässt höchstens gut eines pro Sekunde durch — wer mehr
 * schickt, versucht sich Matches zu erschleichen oder hat einen Fehler im Client.
 */
const SIGNAL_LIMIT = 12
const SIGNAL_WINDOW_MS = 5_000

export function createSocketServer(httpServer: HttpServer): AppServer {
  return new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Auf einem Event wechseln Handys ständig zwischen WLAN und Mobilfunk.
    // Etwas Geduld verhindert, dass jemand deswegen aus dem Pool fällt.
    pingInterval: 10_000,
    pingTimeout: 15_000,
  })
}

export function createHub(io: AppServer): Hub {
  /*
   * Socket.io kann den variadischen Aufruf über den generischen Ereignisnamen nicht
   * typisieren. Der Vertrag ist durch ServerToClientEvents an der Aufrufstelle
   * gesichert, hier braucht es einmalig die Umgehung.
   */
  const emit = (room: string, event: string, args: unknown[]) => {
    ;(io.to(room).emit as (name: string, ...rest: unknown[]) => void)(event, ...args)
  }

  return {
    toParticipant(participantId, event, ...args) {
      emit(participantRoom(participantId), event as string, args)
    },
    toEvent(eventId, event, ...args) {
      emit(eventRoom(eventId), event as string, args)
    },
  }
}

export function attachSocketHandlers(
  io: AppServer,
  engine: GameEngine,
  hub: Hub,
  log: FastifyBaseLogger,
): void {
  io.on('connection', (socket: AppSocket) => {
    socket.data.signalTimes = []

    socket.on(CLIENT_EVENT.hello, (raw, ack) => {
      void handleHello(socket, engine, log, raw, ack)
    })

    /*
     * Uhrenabgleich. Der Zeitstempel wird gesetzt, sobald das Ping hier ankommt —
     * jede Verzögerung danach würde die Schätzung des Clients verfälschen.
     */
    socket.on(CLIENT_EVENT.clockPing, (raw) => {
      const parsed = clockPingPayloadSchema.safeParse(raw)
      if (!parsed.success) return
      socket.emit(SERVER_EVENT.clockPong, { c0: parsed.data.c0, s: Date.now() })
    })

    socket.on(CLIENT_EVENT.heartbeat, () => {
      if (socket.data.participantId) presence.touch(socket.data.participantId)
    })

    socket.on(CLIENT_EVENT.bump, (raw) => {
      const parsed = bumpPayloadSchema.safeParse(raw)
      if (!parsed.success) return
      void handleSignal(socket, engine, hub, log, {
        kind: 'bump',
        pairId: parsed.data.pairId,
        t: parsed.data.t,
        magnitude: parsed.data.magnitude,
      })
    })

    socket.on(CLIENT_EVENT.manualConfirm, (raw) => {
      const parsed = manualConfirmPayloadSchema.safeParse(raw)
      if (!parsed.success) return
      void handleSignal(socket, engine, hub, log, {
        kind: 'manual',
        pairId: parsed.data.pairId,
        t: parsed.data.t,
      })
    })

    socket.on(CLIENT_EVENT.pairCancel, (raw) => {
      const parsed = pairCancelPayloadSchema.safeParse(raw)
      const participantId = socket.data.participantId
      if (!parsed.success || !participantId) return

      void engine
        .cancelPair(participantId, parsed.data.pairId)
        .catch((error) => log.error({ error, participantId }, 'Paar-Abbruch fehlgeschlagen'))
    })

    socket.on(CLIENT_EVENT.queueJoin, () => {
      void setQueued(socket, engine, log, true)
    })

    socket.on(CLIENT_EVENT.queueLeave, () => {
      void setQueued(socket, engine, log, false)
    })

    socket.on('disconnect', () => {
      const orphaned = presence.disconnect(socket.id)
      if (!orphaned) return

      /*
       * Nicht sofort abmelden: Beim Wechsel zwischen WLAN und Mobilfunk trennt sich
       * der Socket kurz und ist eine Sekunde später wieder da. Der Sweeper in der
       * Engine räumt auf, wenn der Heartbeat wirklich ausbleibt.
       */
      log.debug({ participantId: orphaned }, 'Verbindung getrennt, warte auf Heartbeat-Ablauf')
    })
  })
}

async function handleHello(
  socket: AppSocket,
  engine: GameEngine,
  log: FastifyBaseLogger,
  raw: unknown,
  ack: (result: HelloAck | ErrorAck) => void,
): Promise<void> {
  const parsed = helloPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    ack({ ok: false, code: 'invalid_payload', message: 'Ungültige Anmeldung.' })
    return
  }

  try {
    const [row] = await db
      .select()
      .from(participants)
      .where(eq(participants.sessionTokenHash, hashToken(parsed.data.sessionToken)))
      .limit(1)

    if (!row || row.deletedAt) {
      ack({ ok: false, code: 'invalid_session', message: 'Diese Session gilt nicht mehr.' })
      return
    }

    socket.data.participantId = row.id
    socket.data.eventId = row.eventId
    await socket.join([participantRoom(row.id), eventRoom(row.eventId)])
    presence.connect(row.id, row.eventId, socket.id)

    /*
     * Wer nach einem Verbindungsabbruch zurückkommt, gehört wieder in den Pool.
     * Ohne das bliebe man nach jeder Bildschirmsperre stumm auf `offline` stehen
     * und würde von keinem Takt mehr aufgegriffen.
     */
    if (row.state === 'offline') {
      await db
        .update(participants)
        .set({ state: row.photoKey ? 'waiting' : 'onboarding', lastSeenAt: new Date() })
        .where(eq(participants.id, row.id))
    }

    const state = await engine.buildStatePayload(row.id)
    const [event] = await db
      .select({ locale: events.locale })
      .from(events)
      .where(eq(events.id, row.eventId))
      .limit(1)

    ack({
      ok: true,
      participant: state?.participant ?? (await toParticipant(row)),
      game: state?.game ?? null,
      pair: state?.pair ?? null,
      matches: await loadMatches(db, row.id),
      serverTime: Date.now(),
      nextTickAt: state?.nextTickAt ?? null,
      eventLocale: event?.locale ?? DEFAULT_EVENT_LOCALE,
    })
  } catch (error) {
    log.error({ error }, 'Anmeldung am Socket fehlgeschlagen')
    ack({ ok: false, code: 'internal', message: 'Da ist gerade etwas schiefgegangen.' })
  }
}

function allowSignal(socket: AppSocket): boolean {
  const now = Date.now()
  socket.data.signalTimes = socket.data.signalTimes.filter((t) => now - t < SIGNAL_WINDOW_MS)
  if (socket.data.signalTimes.length >= SIGNAL_LIMIT) return false
  socket.data.signalTimes.push(now)
  return true
}

async function handleSignal(
  socket: AppSocket,
  engine: GameEngine,
  hub: Hub,
  log: FastifyBaseLogger,
  input: { kind: 'bump' | 'manual'; pairId: string; t: number; magnitude?: number },
): Promise<void> {
  const participantId = socket.data.participantId
  if (!participantId) return

  if (!allowSignal(socket)) {
    log.warn({ participantId }, 'Signale gedrosselt')
    return
  }

  try {
    await recordSignal(db, hub, {
      participantId,
      pairId: input.pairId,
      kind: input.kind,
      t: input.t,
      ...(input.magnitude === undefined ? {} : { magnitude: input.magnitude }),
    })
  } catch (error) {
    /*
     * Erwartbare Fälle — das Paar ist abgelaufen, das Spiel wurde gestoppt, das
     * Gegenüber war schneller. Kein Grund für einen Fehler im Log, der Client
     * bekommt den aktuellen Stand ohnehin über `state`.
     */
    if (error instanceof AppError) {
      log.debug({ error: error.code, participantId }, 'Signal verworfen')
      await engine.pushState(participantId)
      return
    }
    log.error({ error, participantId }, 'Signal konnte nicht verarbeitet werden')
  }
}

async function setQueued(
  socket: AppSocket,
  engine: GameEngine,
  log: FastifyBaseLogger,
  queued: boolean,
): Promise<void> {
  const participantId = socket.data.participantId
  if (!participantId) return

  try {
    await engine.setQueued(participantId, queued)
  } catch (error) {
    log.error({ error, participantId, queued }, 'Warteschlangen-Wechsel fehlgeschlagen')
  }
}
