/**
 * Zustandsautomat eines Teilnehmers.
 *
 * Zwei Ebenen, bewusst getrennt:
 *
 * - {@link ParticipantState} ist der persistierte Zustand. Der Server ist dafür die
 *   einzige Autorität; nach einem Reload oder einer Bildschirmsperre wird er von
 *   dort wiederhergestellt.
 * - {@link PlayPhase} ist die Anzeige-Ebene. Sie kennt Zwischenstufen, die der
 *   Server nicht wissen muss — etwa `confirming`, den Moment zwischen dem eigenen
 *   Stoß und dem des Gegenübers.
 */

import type { ActivePair, MatchRecord, ParticipantState } from './types.js'

/**
 * Erlaubte Übergänge des persistierten Zustands.
 *
 * `offline` ist von überall erreichbar (Verbindungsabbruch) und führt beim
 * Reconnect zurück in den Zustand, den der Server in der Datenbank vorfindet.
 */
const TRANSITIONS: Record<ParticipantState, readonly ParticipantState[]> = {
  onboarding: ['waiting', 'offline'],
  waiting: ['searching', 'idle', 'offline'],
  searching: ['matched', 'waiting', 'idle', 'offline'],
  matched: ['waiting', 'idle', 'offline'],
  idle: ['waiting', 'offline'],
  offline: ['waiting', 'searching', 'matched', 'idle', 'onboarding'],
}

export function canTransition(from: ParticipantState, to: ParticipantState): boolean {
  if (from === to) return true
  return TRANSITIONS[from].includes(to)
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ParticipantState,
    readonly to: ParticipantState,
  ) {
    super(`Unerlaubter Zustandswechsel: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function assertTransition(from: ParticipantState, to: ParticipantState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}

/** Nimmt dieser Zustand am 10-Sekunden-Takt des Matchers teil? */
export function isMatchable(state: ParticipantState): boolean {
  return state === 'waiting'
}

/* ------------------------------------------------------------ Anzeige-Ebene */

export type PlayPhase =
  /** Verbindung steht noch nicht oder der Zustand wird geladen. */
  | { kind: 'loading' }
  /** Im Pool, wartet auf den nächsten Takt. */
  | { kind: 'waiting'; nextTickAt: number | null }
  /** Partner zugewiesen, Person wird gesucht. */
  | { kind: 'searching'; pair: ActivePair }
  /** Eigener Stoß erkannt, das Gegenüber fehlt noch. */
  | { kind: 'confirming'; pair: ActivePair; bumpAt: number }
  /** Match steht, Profil ist enthüllt. */
  | { kind: 'matched'; match: MatchRecord }
  /** Bewusst aus dem Pool ausgetreten („erstmal unterhalten"). */
  | { kind: 'idle' }
  /** Admin hat das Spiel pausiert. */
  | { kind: 'paused' }
  /** Admin hat das Spiel beendet. */
  | { kind: 'ended' }

/**
 * Wie lange der eigene erkannte Stoß auf den des Gegenübers wartet, bevor die
 * Anzeige zurück auf „suchen" fällt. Etwas großzügiger als das Server-Fenster,
 * damit die Bestätigung nicht sichtbar an der Anzeige vorbeiläuft.
 */
export const CONFIRMING_HOLD_MS = 2_500

/** Reicht die verbleibende Zeit noch, damit sich die beiden finden können? */
export function pairTimeLeftMs(pair: ActivePair, serverNowMs: number): number {
  return Math.max(0, pair.expiresAt - serverNowMs)
}
