/**
 * Uhrenabgleich zwischen Gerät und Server.
 *
 * Der Server entscheidet über einen Match, indem er zwei Stoß-Zeitpunkte
 * vergleicht. Geräteuhren weichen aber um Sekunden voneinander ab — ohne Abgleich
 * wäre dieser Vergleich wertlos.
 *
 * Deshalb: Zeitstempel werden **auf dem Gerät** gesetzt (die Netzwerklatenz fällt
 * damit heraus) und über den hier berechneten Offset in Serverzeit umgerechnet.
 */

/** Eine Runde des Handshakes, aus Sicht des Clients. */
export interface ClockRoundTrip {
  /** Clientzeit beim Absenden. */
  c0: number
  /** Serverzeit beim Empfang. */
  s: number
  /** Clientzeit beim Eintreffen der Antwort. */
  c1: number
}

export interface ClockEstimate {
  offsetMs: number
  rttMs: number
}

/**
 * NTP-Schätzung einer einzelnen Runde: Der Server hat seinen Zeitstempel im Mittel
 * eine halbe Umlaufzeit nach dem Absenden gesetzt.
 */
export function estimateFromRoundTrip(rt: ClockRoundTrip): ClockEstimate {
  return {
    offsetMs: rt.s - (rt.c0 + rt.c1) / 2,
    rttMs: rt.c1 - rt.c0,
  }
}

/**
 * Aus mehreren Runden die mit der kleinsten Umlaufzeit wählen.
 *
 * Nicht der Mittelwert: Eine langsame Runde ist fast immer asymmetrisch verzögert
 * (Funkloch, Puffer im WLAN) und verzerrt den Offset. Die schnellste Runde ist die
 * mit der geringsten möglichen Asymmetrie — im Event-WLAN ein spürbarer Unterschied.
 */
export function bestEstimate(roundTrips: readonly ClockRoundTrip[]): ClockEstimate | null {
  let best: ClockEstimate | null = null
  for (const rt of roundTrips) {
    const estimate = estimateFromRoundTrip(rt)
    if (best === null || estimate.rttMs < best.rttMs) best = estimate
  }
  return best
}

export interface ClockOptions {
  /** So viele der letzten Runden bleiben in der Auswahl. */
  maxSamples: number
  /** Über dieser Umlaufzeit wird eine Runde gar nicht erst berücksichtigt. */
  maxAcceptableRttMs: number
}

export const DEFAULT_CLOCK_OPTIONS: ClockOptions = {
  maxSamples: 8,
  maxAcceptableRttMs: 2_000,
}

export interface Clock {
  /** Ergebnis einer Handshake-Runde einspeisen. */
  ingest(roundTrip: ClockRoundTrip): void
  /** Lokale Zeit in Serverzeit umrechnen. Ohne Abgleich die Identität. */
  toServerTime(localMs: number): number
  /** Aktuelle Serverzeit, geschätzt. */
  now(localNowMs: number): number
  readonly estimate: ClockEstimate | null
  readonly synced: boolean
  reset(): void
}

export function createClock(options: Partial<ClockOptions> = {}): Clock {
  const opts: ClockOptions = { ...DEFAULT_CLOCK_OPTIONS, ...options }
  let roundTrips: ClockRoundTrip[] = []
  let current: ClockEstimate | null = null

  return {
    get estimate() {
      return current
    },
    get synced() {
      return current !== null
    },

    ingest(roundTrip: ClockRoundTrip) {
      const estimate = estimateFromRoundTrip(roundTrip)
      // Unplausible Runden gar nicht erst aufnehmen: negative Umlaufzeit bedeutet
      // eine verstellte Uhr während des Handshakes, zu lange Runden sind Ausreißer.
      if (estimate.rttMs < 0 || estimate.rttMs > opts.maxAcceptableRttMs) return

      roundTrips.push(roundTrip)
      if (roundTrips.length > opts.maxSamples) {
        roundTrips = roundTrips.slice(-opts.maxSamples)
      }
      current = bestEstimate(roundTrips)
    },

    toServerTime(localMs: number) {
      return current === null ? localMs : localMs + current.offsetMs
    },

    now(localNowMs: number) {
      return this.toServerTime(localNowMs)
    },

    reset() {
      roundTrips = []
      current = null
    },
  }
}
