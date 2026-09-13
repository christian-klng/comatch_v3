/**
 * Der Realtime-Vertrag zwischen Client und Server.
 *
 * Alle Nutzlasten sind zod-validiert — der Server vertraut keinem Client-Payload,
 * und beide Seiten teilen sich exakt dieselbe Definition. Socket.io-Typen tauchen
 * hier bewusst nicht auf, damit das Paket ohne Transport-Abhängigkeit bleibt.
 */

import { z } from 'zod'
import type { Locale } from './i18n/locale.js'
import type {
  ActivePair,
  Game,
  MatchRecord,
  PairEndReason,
  Participant,
  PartnerRevealed,
  SignalKind,
} from './types.js'

/* --------------------------------------------------------- Client → Server */

export const helloPayloadSchema = z.object({
  sessionToken: z.string().min(1),
})
export type HelloPayload = z.infer<typeof helloPayloadSchema>

export const clockPingPayloadSchema = z.object({
  /** Clientzeit beim Absenden — kommt unverändert zurück. */
  c0: z.number(),
})
export type ClockPingPayload = z.infer<typeof clockPingPayloadSchema>

/**
 * Zeitstempel in Serverzeit, auf ganze Millisekunden gerundet.
 *
 * Beide Quellen liefern Bruchteile: `performance.timeOrigin + event.timeStamp` hat
 * Sub-Millisekunden-Auflösung, und der Uhren-Offset entsteht aus einer Division
 * durch zwei. Bei einem Zeitfenster von gut einer Sekunde sagen diese Nachkommastellen
 * nichts aus — und die Spalte in der Datenbank ist ein bigint, der sie zurückweist.
 * Deshalb wird hier gerundet, an der einen Stelle, die Client und Server teilen.
 */
const serverTimestamp = z
  .number()
  .finite()
  .transform((value) => Math.round(value))

export const bumpPayloadSchema = z.object({
  pairId: z.string().min(1),
  /** Zeitpunkt des Ausschlag-Maximums, bereits in Serverzeit umgerechnet. */
  t: serverTimestamp,
  magnitude: z.number().nonnegative(),
})
export type BumpPayload = z.infer<typeof bumpPayloadSchema>

export const manualConfirmPayloadSchema = z.object({
  pairId: z.string().min(1),
  t: serverTimestamp,
})
export type ManualConfirmPayload = z.infer<typeof manualConfirmPayloadSchema>

export const pairCancelPayloadSchema = z.object({
  pairId: z.string().min(1),
})
export type PairCancelPayload = z.infer<typeof pairCancelPayloadSchema>

/* --------------------------------------------------------- Server → Client */

export interface HelloAck {
  ok: true
  participant: Participant
  game: Game | null
  pair: ActivePair | null
  matches: MatchRecord[]
  /** Serverzeit beim Beantworten — grober Erstabgleich vor dem ersten Ping. */
  serverTime: number
  /**
   * Serverzeit des nächsten Matcher-Takts.
   *
   * Gehört schon in die Begrüßung: Sonst hätte ein gerade verbundener Teilnehmer
   * bis zum nächsten Takt keinen Countdown — also genau in der Spanne, in der er
   * am ehesten wissen will, wie lange es noch dauert.
   */
  nextTickAt: number | null
  /**
   * Bei jeder Begrüßung neu, nicht nur über `event:changed`: Wer beim Umstellen das
   * Handy gesperrt hatte, hat das Ereignis verpasst und bekommt den Stand hier.
   */
  eventLocale: Locale
}

export interface ErrorAck {
  ok: false
  code: SocketErrorCode
  message: string
}

export type Ack<T> = ({ ok: true } & T) | ErrorAck

export const SOCKET_ERROR_CODES = [
  'invalid_session',
  'invalid_payload',
  'no_active_game',
  'no_active_pair',
  'pair_not_pending',
  'manual_confirm_disabled',
  'rate_limited',
  'internal',
] as const
export type SocketErrorCode = (typeof SOCKET_ERROR_CODES)[number]

export interface ClockPongPayload {
  c0: number
  /** Serverzeit beim Empfang des Pings. */
  s: number
}

export interface StatePayload {
  participant: Participant
  game: Game | null
  pair: ActivePair | null
  serverTime: number
  /** Serverzeit des nächsten Matcher-Takts — treibt den Countdown im Wartescreen. */
  nextTickAt: number | null
}

export interface PairAssignedPayload {
  pair: ActivePair
  serverTime: number
}

export interface PairEndedPayload {
  pairId: string
  reason: PairEndReason
}

export interface MatchConfirmedPayload {
  pairId: string
  partner: PartnerRevealed
  confirmedAt: string
  /** Wodurch der Match zustande kam — der Admin sieht daraus die Bump-Qualität. */
  via: SignalKind
  /** Eigener Zählerstand nach diesem Match. */
  totalMatches: number
}

export interface GameChangedPayload {
  game: Game | null
}

/** Der Admin hat die Eventsprache umgestellt — gilt sofort, ohne Neuladen. */
export interface EventChangedPayload {
  locale: Locale
}

/* ------------------------------------------------------------ Event-Namen */

export const CLIENT_EVENT = {
  hello: 'hello',
  heartbeat: 'heartbeat',
  clockPing: 'clock:ping',
  bump: 'signal:bump',
  manualConfirm: 'signal:manual',
  pairCancel: 'pair:cancel',
  queueJoin: 'queue:join',
  queueLeave: 'queue:leave',
} as const

export const SERVER_EVENT = {
  state: 'state',
  clockPong: 'clock:pong',
  pairAssigned: 'pair:assigned',
  pairEnded: 'pair:ended',
  matchConfirmed: 'match:confirmed',
  gameChanged: 'game:changed',
  eventChanged: 'event:changed',
} as const

/**
 * Für die Typisierung von `Server`/`Socket` auf beiden Seiten.
 * Socket.io akzeptiert diese schlichten Interfaces direkt als Generics.
 */
export interface ClientToServerEvents {
  [CLIENT_EVENT.hello]: (payload: HelloPayload, ack: (result: HelloAck | ErrorAck) => void) => void
  [CLIENT_EVENT.heartbeat]: () => void
  [CLIENT_EVENT.clockPing]: (payload: ClockPingPayload) => void
  [CLIENT_EVENT.bump]: (payload: BumpPayload) => void
  [CLIENT_EVENT.manualConfirm]: (payload: ManualConfirmPayload) => void
  [CLIENT_EVENT.pairCancel]: (payload: PairCancelPayload) => void
  [CLIENT_EVENT.queueJoin]: () => void
  [CLIENT_EVENT.queueLeave]: () => void
}

export interface ServerToClientEvents {
  [SERVER_EVENT.state]: (payload: StatePayload) => void
  [SERVER_EVENT.clockPong]: (payload: ClockPongPayload) => void
  [SERVER_EVENT.pairAssigned]: (payload: PairAssignedPayload) => void
  [SERVER_EVENT.pairEnded]: (payload: PairEndedPayload) => void
  [SERVER_EVENT.matchConfirmed]: (payload: MatchConfirmedPayload) => void
  [SERVER_EVENT.gameChanged]: (payload: GameChangedPayload) => void
  [SERVER_EVENT.eventChanged]: (payload: EventChangedPayload) => void
}

/** Heartbeat-Takt und Kulanz, bis ein stiller Client aus dem Pool fliegt. */
export const HEARTBEAT_INTERVAL_MS = 5_000
export const PRESENCE_TIMEOUT_MS = 20_000

/** Runden je Uhrenabgleich und Abstand zwischen zwei Abgleichen. */
export const CLOCK_SYNC_ROUNDS = 5
export const CLOCK_SYNC_INTERVAL_MS = 60_000
