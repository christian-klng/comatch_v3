import { describe, expect, it } from 'vitest'
import {
  bumpsMatch,
  calibrateThreshold,
  createBumpDetector,
  detectBumps,
  type MotionSample,
} from './bump.js'

const GRAVITY = 9.81
const SAMPLE_RATE_HZ = 60

/**
 * Baut eine Messreihe: Die Beschleunigung liegt komplett auf der z-Achse, damit
 * `magnitude` exakt dem vorgegebenen Verlauf entspricht und die Tests nachrechenbar
 * bleiben.
 */
function series(
  durationMs: number,
  magnitudeAt: (t: number) => number,
  { rateHz = SAMPLE_RATE_HZ, startAt = 0 } = {},
): MotionSample[] {
  const step = 1000 / rateHz
  const samples: MotionSample[] = []
  for (let t = 0; t <= durationMs; t += step) {
    samples.push({ t: startAt + t, x: 0, y: 0, z: magnitudeAt(t) })
  }
  return samples
}

/** Ein Stoß ist ein kurzer, steiler Ausschlag — modelliert als schmale Glocke. */
function spike(t: number, at: number, amplitude: number, widthMs = 25): number {
  const d = (t - at) / widthMs
  return amplitude * Math.exp(-(d * d))
}

/** Reproduzierbares Rauschen, damit die Tests nicht flackern. */
function noise(t: number, amplitude = 0.05): number {
  return amplitude * Math.sin(t * 0.7) * Math.cos(t * 0.23)
}

describe('createBumpDetector', () => {
  it('meldet nichts, wenn das Handy ruhig liegt', () => {
    const samples = series(5_000, (t) => GRAVITY + noise(t))
    expect(detectBumps(samples)).toHaveLength(0)
  })

  it('meldet nichts beim Gehen', () => {
    // Schritte erzeugen periodische Ausschläge um 3–4 m/s² bei ~2 Hz.
    const samples = series(10_000, (t) => GRAVITY + 3.5 * Math.sin((t / 1000) * 2 * Math.PI * 2))
    expect(detectBumps(samples)).toHaveLength(0)
  })

  it('meldet nichts, wenn das Handy in die Tasche gesteckt wird', () => {
    // Langsame Lageänderung: die Schwerkraft wandert über 800 ms auf eine andere Achse.
    const samples = series(4_000, (t) => {
      if (t < 1_000) return GRAVITY + noise(t)
      if (t > 1_800) return GRAVITY + noise(t)
      const progress = (t - 1_000) / 800
      return GRAVITY + 4 * Math.sin(progress * Math.PI)
    })
    expect(detectBumps(samples)).toHaveLength(0)
  })

  it('erkennt einen Stoß und meldet den Zeitpunkt des Maximums', () => {
    const samples = series(3_000, (t) => GRAVITY + noise(t) + spike(t, 1_500, 25))
    const bumps = detectBumps(samples)

    expect(bumps).toHaveLength(1)
    // Das Maximum darf höchstens ein Sample neben dem echten Scheitel liegen.
    expect(bumps[0]!.t).toBeGreaterThanOrEqual(1_480)
    expect(bumps[0]!.t).toBeLessThanOrEqual(1_520)
    expect(bumps[0]!.magnitude).toBeGreaterThan(20)
  })

  it('zählt Nachschwingen nicht als zweiten Stoß', () => {
    // Der Rückprall 120 ms nach dem Aufprall darf nicht doppelt zählen.
    const samples = series(
      3_000,
      (t) => GRAVITY + noise(t) + spike(t, 1_500, 25) + spike(t, 1_620, 16),
    )
    expect(detectBumps(samples)).toHaveLength(1)
  })

  it('erkennt zwei getrennte Stöße nach Ablauf der Sperre', () => {
    const samples = series(
      4_000,
      (t) => GRAVITY + noise(t) + spike(t, 1_000, 25) + spike(t, 2_500, 25),
    )
    const bumps = detectBumps(samples)

    expect(bumps).toHaveLength(2)
    expect(bumps[1]!.t - bumps[0]!.t).toBeGreaterThan(1_400)
  })

  it('bleibt bei Dauerschütteln stehen statt endlos zu warten', () => {
    // Ohne die maxPeakMs-Grenze bliebe der Detektor im Peak-Zustand hängen.
    const samples = series(2_000, (t) => GRAVITY + 20 * Math.sin((t / 1000) * 2 * Math.PI * 8))
    const bumps = detectBumps(samples)

    expect(bumps.length).toBeGreaterThan(0)
    expect(bumps.length).toBeLessThan(samples.length)
  })

  it('arbeitet bei 200 Hz genauso wie bei 50 Hz', () => {
    // Der Tiefpass ist zeitbasiert — die Sample-Rate darf das Ergebnis nicht ändern.
    const shape = (t: number) => GRAVITY + noise(t) + spike(t, 1_000, 25)
    const slow = detectBumps(series(2_000, shape, { rateHz: 50 }))
    const fast = detectBumps(series(2_000, shape, { rateHz: 200 }))

    expect(slow).toHaveLength(1)
    expect(fast).toHaveLength(1)
    expect(Math.abs(slow[0]!.t - fast[0]!.t)).toBeLessThan(25)
    expect(Math.abs(slow[0]!.magnitude - fast[0]!.magnitude)).toBeLessThan(2)
  })

  it('übersteht Lücken im Stream, etwa nach einem kurzen Tab-Wechsel', () => {
    const before = series(1_000, (t) => GRAVITY + noise(t))
    const after = series(2_000, (t) => GRAVITY + noise(t) + spike(t, 500, 25), { startAt: 9_000 })

    expect(detectBumps([...before, ...after])).toHaveLength(1)
  })

  it('respektiert eine angehobene Schwelle', () => {
    const samples = series(2_000, (t) => GRAVITY + noise(t) + spike(t, 1_000, 14))

    expect(detectBumps(samples, { threshold: 12 })).toHaveLength(1)
    expect(detectBumps(samples, { threshold: 20 })).toHaveLength(0)
  })

  it('schwingt nach reset() sauber neu ein', () => {
    const detector = createBumpDetector()
    for (const sample of series(1_000, (t) => GRAVITY + noise(t))) detector.push(sample)

    expect(detector.baseline).toBeCloseTo(GRAVITY, 0)
    detector.reset()
    expect(detector.baseline).toBeNull()
  })
})

describe('calibrateThreshold', () => {
  it('setzt die Schwelle unter die gemessenen Probe-Stöße', () => {
    expect(calibrateThreshold([20, 22, 21])).toBeCloseTo(12.6, 1)
  })

  it('ist unempfindlich gegen einen verunglückten Probe-Stoß', () => {
    // Ein zu zaghafter Versuch darf die Schwelle nicht nach unten reißen.
    expect(calibrateThreshold([21, 22, 3])).toBeCloseTo(calibrateThreshold([21, 22, 20]), 0)
  })

  it('bleibt in der plausiblen Bandbreite', () => {
    expect(calibrateThreshold([2, 2, 2])).toBe(8)
    expect(calibrateThreshold([200, 200, 200])).toBe(30)
  })

  it('fällt ohne Messwerte auf die Voreinstellung zurück', () => {
    expect(calibrateThreshold([])).toBe(12)
  })
})

describe('bumpsMatch', () => {
  const strong = { magnitude: 20 }

  it('akzeptiert zwei Stöße innerhalb des Fensters', () => {
    expect(bumpsMatch({ t: 1_000, ...strong }, { t: 1_400, ...strong }, 1_200, 8)).toBe(true)
  })

  it('lehnt zu weit auseinanderliegende Stöße ab', () => {
    expect(bumpsMatch({ t: 1_000, ...strong }, { t: 3_000, ...strong }, 1_200, 8)).toBe(false)
  })

  it('lehnt einen zu schwachen Stoß ab, auch wenn er zeitlich passt', () => {
    expect(bumpsMatch({ t: 1_000, ...strong }, { t: 1_050, magnitude: 5 }, 1_200, 8)).toBe(false)
  })

  it('ist symmetrisch', () => {
    const a = { t: 1_000, magnitude: 20 }
    const b = { t: 1_900, magnitude: 20 }
    expect(bumpsMatch(a, b, 1_200, 8)).toBe(bumpsMatch(b, a, 1_200, 8))
  })
})
