/**
 * Zentrale Domänentypen von CoMatch.
 *
 * Dieses Paket ist bewusst frei von Plattform-APIs (kein `window`, kein `document`,
 * kein Node-Builtin) — es wandert unverändert in die spätere Expo/iOS-App.
 */

export type Id = string

/* ------------------------------------------------------------------ Spiele */

export const GAME_TYPES = ['find_me'] as const
export type GameType = (typeof GAME_TYPES)[number]

export const GAME_STATES = ['idle', 'running', 'paused', 'ended'] as const
export type GameState = (typeof GAME_STATES)[number]

/**
 * Konfiguration von „Find me". Liegt als JSON am Spiel, damit sich die Parameter
 * nach den ersten echten Events nachziehen lassen, ohne ein Deployment zu brauchen.
 */
export interface FindMeConfig {
  /** Takt, in dem der Matcher wartende Teilnehmer paart. */
  tickIntervalMs: number
  /** Findet ein Paar sich nicht, wird es nach dieser Zeit aufgelöst. */
  pairTimeoutMs: number
  /** Maximaler Zeitversatz zwischen den beiden Bumps, damit sie als ein Stoß gelten. */
  bumpWindowMs: number
  /** Untergrenze, damit ein zufälliger Wackler nicht als Stoß zählt (m/s²). */
  minBumpMagnitude: number
  /** Manuelle Bestätigung als Rückfallebene erlauben (Sensor verweigert/fehlt). */
  allowManualConfirm: boolean
  /** Beide manuellen Bestätigungen müssen innerhalb dieser Spanne liegen. */
  manualConfirmWindowMs: number
  /** So lange sucht man, bevor der Hinweis auf die Rückfallebene erscheint. */
  manualConfirmHintAfterMs: number
}

export const DEFAULT_FIND_ME_CONFIG: FindMeConfig = {
  tickIntervalMs: 10_000,
  pairTimeoutMs: 180_000,
  bumpWindowMs: 1_200,
  minBumpMagnitude: 8,
  allowManualConfirm: true,
  manualConfirmWindowMs: 10_000,
  manualConfirmHintAfterMs: 20_000,
}

export interface Game {
  id: Id
  eventId: Id
  type: GameType
  state: GameState
  config: FindMeConfig
  startedAt: string | null
  endedAt: string | null
}

/* ------------------------------------------------------------------ Events */

export interface EventSummary {
  id: Id
  slug: string
  name: string
  startsAt: string | null
  endsAt: string | null
}

/** Was ein Teilnehmer über das Event sehen darf, bevor er beitritt. */
export interface EventPublic extends EventSummary {
  activeGame: Game | null
}

/* ------------------------------------------------------------ Teilnehmende */

/**
 * Persistierte Zustände. `searching` deckt die gesamte Suchphase ab — auch den
 * Moment, in dem der eigene Stoß schon erkannt wurde und auf das Gegenüber
 * gewartet wird. Diese Zwischenstufe ist reine Anzeige und lebt clientseitig
 * als {@link PlayPhase} `confirming`.
 */
export const PARTICIPANT_STATES = [
  'onboarding',
  'waiting',
  'searching',
  'matched',
  'idle',
  'offline',
] as const
export type ParticipantState = (typeof PARTICIPANT_STATES)[number]

export interface ParticipantProfile {
  company?: string
  role?: string
  linkedin?: string
}

/** Die eigene Sicht auf sich selbst. */
export interface Participant {
  id: Id
  eventId: Id
  displayName: string
  photoUrl: string | null
  profile: ParticipantProfile
  state: ParticipantState
  createdAt: string
}

/**
 * Was das Gegenüber während der Suche sieht: Foto und Vorname — mehr nicht.
 * Das Profil würde die Suche verraten und wird erst nach dem Match enthüllt.
 */
export interface PartnerPublic {
  id: Id
  displayName: string
  photoUrl: string | null
}

/** Nach einem bestätigten Match zusätzlich das Profil. */
export interface PartnerRevealed extends PartnerPublic {
  profile: ParticipantProfile
}

/* ------------------------------------------------------------------- Paare */

export const PAIR_STATES = ['pending', 'confirmed', 'expired', 'cancelled'] as const
export type PairState = (typeof PAIR_STATES)[number]

export const PAIR_END_REASONS = ['expired', 'cancelled', 'partner_left', 'game_stopped'] as const
export type PairEndReason = (typeof PAIR_END_REASONS)[number]

export interface ActivePair {
  id: Id
  partner: PartnerPublic
  /** Serverzeit in ms, zu der das Paar ohne Bestätigung aufgelöst wird. */
  expiresAt: number
  createdAt: number
}

export interface MatchRecord {
  pairId: Id
  partner: PartnerRevealed
  confirmedAt: string
}

/* ------------------------------------------------------------------ Signale */

/** Woher die Bestätigung kam — für die Auswertung nach dem Event wichtig. */
export const SIGNAL_KINDS = ['bump', 'manual'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]

/* ------------------------------------------------------------- Admin-Sicht */

export interface AdminAccount {
  id: Id
  email: string
}

export interface AdminParticipantRow {
  id: Id
  displayName: string
  photoUrl: string | null
  state: ParticipantState
  online: boolean
  matchCount: number
  joinedAt: string
}

export interface GameStats {
  participantsTotal: number
  participantsOnline: number
  waiting: number
  searching: number
  matchesConfirmed: number
  /** Median der Zeit von Paar-Zuweisung bis Bestätigung, in ms. */
  medianTimeToMatchMs: number | null
  /** Anteil der Bestätigungen, die über die Rückfallebene kamen — misst die Bump-Qualität. */
  manualConfirmRatio: number
}
