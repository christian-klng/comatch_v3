/**
 * Bump-Erkennung: findet in einem Beschleunigungs-Stream den Moment, in dem zwei
 * Handys aneinander gestoßen wurden.
 *
 * Bewusst als reine Funktion über einem Sample-Stream gebaut — ohne Sensor-API.
 * Im Web speist `useDeviceMotion` die Samples ein, in der späteren iOS-App
 * `expo-sensors`. Getestet wird gegen aufgezeichnete Serien, nicht gegen ein Gerät.
 */

/** Ein Messwert des Beschleunigungssensors, inklusive Schwerkraft (m/s²). */
export interface MotionSample {
  /** Zeitstempel in ms. Der Aufrufer entscheidet, ob lokal oder serverkorrigiert. */
  t: number
  x: number
  y: number
  z: number
}

export interface BumpEvent {
  /** Zeitpunkt des Ausschlag-Maximums — nicht der des Schwellen-Übertritts. */
  t: number
  /** Lineare Beschleunigung im Maximum, Schwerkraft herausgerechnet (m/s²). */
  magnitude: number
}

export interface BumpDetectorOptions {
  /** Ab dieser linearen Beschleunigung gilt es als Stoß (m/s²). */
  threshold: number
  /** Sperre nach einem erkannten Stoß, gegen Doppelauslösung durch Nachschwingen. */
  cooldownMs: number
  /**
   * Zeitkonstante des Schwerkraft-Tiefpasses in ms. Zeitbasiert statt als fester
   * Glättungsfaktor, weil die Sample-Rate zwischen Geräten stark schwankt
   * (iOS ~60 Hz, Android 50–200 Hz) — ein fester Faktor würde sonst auf jedem
   * Gerät eine andere Filterwirkung haben.
   */
  gravityTauMs: number
  /**
   * Spätestens so lange nach dem Übertritt wird das Maximum ausgegeben, auch wenn
   * der Wert nicht unter die Freigabeschwelle zurückfällt (Dauerschütteln).
   */
  maxPeakMs: number
  /** Anteil der Schwelle, unter den der Wert fallen muss, damit der Stoß endet. */
  releaseRatio: number
}

export const DEFAULT_BUMP_OPTIONS: BumpDetectorOptions = {
  threshold: 12,
  cooldownMs: 800,
  gravityTauMs: 150,
  maxPeakMs: 250,
  releaseRatio: 0.5,
}

/** Plausible Bandbreite für die kalibrierte Schwelle (m/s²). */
export const MIN_CALIBRATED_THRESHOLD = 8
export const MAX_CALIBRATED_THRESHOLD = 30

/** Größte Lücke zwischen zwei Samples, die für den Tiefpass noch berücksichtigt wird. */
const MAX_SAMPLE_GAP_MS = 200

export interface BumpDetector {
  /** Nächstes Sample einspeisen. Gibt einen Stoß zurück, sobald einer abgeschlossen ist. */
  push(sample: MotionSample): BumpEvent | null
  /** Nach einem Match oder einem Phasenwechsel den Filter neu einschwingen lassen. */
  reset(): void
  /** Aktueller Schwerkraft-Schätzwert — nur für Diagnose und Kalibrierungs-UI. */
  readonly baseline: number | null
  /** Letzte gemessene lineare Beschleunigung — treibt die Live-Anzeige. */
  readonly linear: number
}

type Phase = 'idle' | 'peak' | 'cooldown'

export function createBumpDetector(options: Partial<BumpDetectorOptions> = {}): BumpDetector {
  const opts: BumpDetectorOptions = { ...DEFAULT_BUMP_OPTIONS, ...options }
  const releaseThreshold = opts.threshold * opts.releaseRatio

  let baseline: number | null = null
  let linear = 0
  let lastT: number | null = null
  let phase: Phase = 'idle'
  let peak: BumpEvent | null = null
  let peakStartedAt = 0
  let cooldownUntil = 0

  return {
    get baseline() {
      return baseline
    },
    get linear() {
      return linear
    },

    reset() {
      baseline = null
      linear = 0
      lastT = null
      phase = 'idle'
      peak = null
      peakStartedAt = 0
      cooldownUntil = 0
    },

    push(sample: MotionSample): BumpEvent | null {
      const magnitude = Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2)

      // Erstes Sample: Der Tiefpass hat noch keinen Bezugswert.
      if (baseline === null || lastT === null) {
        baseline = magnitude
        lastT = sample.t
        return null
      }

      const dt = Math.min(Math.max(sample.t - lastT, 1), MAX_SAMPLE_GAP_MS)
      lastT = sample.t
      linear = Math.abs(magnitude - baseline)

      if (phase === 'cooldown') {
        // Während des Nachschwingens die Schwerkraft nicht nachführen — sonst
        // würde der Filter dem Ausschlag hinterherlaufen und wäre danach verstimmt.
        if (sample.t >= cooldownUntil) phase = 'idle'
        return null
      }

      if (phase === 'idle') {
        if (linear > opts.threshold) {
          phase = 'peak'
          peak = { t: sample.t, magnitude: linear }
          peakStartedAt = sample.t
          return null
        }
        // Nur in Ruhe nachführen, damit der Stoß selbst den Bezugswert nicht verschiebt.
        const alpha = Math.exp(-dt / opts.gravityTauMs)
        baseline = alpha * baseline + (1 - alpha) * magnitude
        return null
      }

      // phase === 'peak'
      if (peak !== null && linear > peak.magnitude) {
        peak = { t: sample.t, magnitude: linear }
      }

      const released = linear < releaseThreshold
      const timedOut = sample.t - peakStartedAt >= opts.maxPeakMs
      if (released || timedOut) {
        const detected = peak
        peak = null
        phase = 'cooldown'
        cooldownUntil = sample.t + opts.cooldownMs
        return detected
      }

      return null
    },
  }
}

/** Läuft den Detektor über eine fertige Serie. Grundlage der Unit-Tests. */
export function detectBumps(
  samples: readonly MotionSample[],
  options: Partial<BumpDetectorOptions> = {},
): BumpEvent[] {
  const detector = createBumpDetector(options)
  const found: BumpEvent[] = []
  for (const sample of samples) {
    const bump = detector.push(sample)
    if (bump) found.push(bump)
  }
  return found
}

export interface CalibrationOptions {
  /** Anteil des gemessenen Ausschlags, der als Schwelle gesetzt wird. */
  ratio: number
  min: number
  max: number
}

export const DEFAULT_CALIBRATION: CalibrationOptions = {
  ratio: 0.6,
  min: MIN_CALIBRATED_THRESHOLD,
  max: MAX_CALIBRATED_THRESHOLD,
}

/**
 * Leitet aus den Probe-Stößen des Onboardings die Schwelle für dieses Gerät ab.
 *
 * Die Sensorempfindlichkeit unterscheidet sich zwischen Geräten um ein Vielfaches —
 * eine feste Schwelle wäre auf dem einen Handy taub und auf dem anderen
 * überempfindlich. Der Median ist robust gegen einen verunglückten Probe-Stoß.
 */
export function calibrateThreshold(
  peakMagnitudes: readonly number[],
  options: Partial<CalibrationOptions> = {},
): number {
  const { ratio, min, max } = { ...DEFAULT_CALIBRATION, ...options }
  if (peakMagnitudes.length === 0) return DEFAULT_BUMP_OPTIONS.threshold

  const sorted = [...peakMagnitudes].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2

  return Math.min(Math.max(median * ratio, min), max)
}

/**
 * Entscheidet, ob zwei Stöße derselbe physische Kontakt waren.
 *
 * Der Stoß ist zwar objektiv gleichzeitig, aber Sample-Rate und Einschwingzeit des
 * Tiefpasses unterscheiden sich je Gerät. Das Fenster darf deshalb großzügig sein:
 * bestätigen können sich ohnehin nur die zwei einander zugewiesenen Personen.
 */
export function bumpsMatch(
  a: Pick<BumpEvent, 't' | 'magnitude'>,
  b: Pick<BumpEvent, 't' | 'magnitude'>,
  windowMs: number,
  minMagnitude: number,
): boolean {
  if (a.magnitude < minMagnitude || b.magnitude < minMagnitude) return false
  return Math.abs(a.t - b.t) <= windowMs
}
