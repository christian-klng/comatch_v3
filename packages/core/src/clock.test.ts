import { describe, expect, it } from 'vitest'
import { bestEstimate, createClock, estimateFromRoundTrip } from './clock.js'

describe('estimateFromRoundTrip', () => {
  it('rechnet Offset und Umlaufzeit aus einer symmetrischen Runde', () => {
    // Client sendet bei 1000, Server empfängt bei 5050, Antwort ist bei 1100 da.
    // Die Serveruhr geht also rund 4 Sekunden vor.
    const estimate = estimateFromRoundTrip({ c0: 1_000, s: 5_050, c1: 1_100 })

    expect(estimate.offsetMs).toBe(4_000)
    expect(estimate.rttMs).toBe(100)
  })

  it('liefert Offset 0, wenn beide Uhren gleich gehen', () => {
    expect(estimateFromRoundTrip({ c0: 1_000, s: 1_050, c1: 1_100 }).offsetMs).toBe(0)
  })
})

describe('bestEstimate', () => {
  it('nimmt die schnellste Runde, nicht den Mittelwert', () => {
    // Die langsame Runde ist asymmetrisch verzögert und würde den Offset verziehen.
    const estimate = bestEstimate([
      { c0: 0, s: 1_000, c1: 800 },
      { c0: 2_000, s: 3_020, c1: 2_040 },
    ])

    expect(estimate?.rttMs).toBe(40)
    expect(estimate?.offsetMs).toBe(1_000)
  })

  it('gibt ohne Runden null zurück', () => {
    expect(bestEstimate([])).toBeNull()
  })
})

describe('createClock', () => {
  it('gibt die lokale Zeit unverändert zurück, solange nicht abgeglichen wurde', () => {
    const clock = createClock()

    expect(clock.synced).toBe(false)
    expect(clock.toServerTime(1_234)).toBe(1_234)
  })

  it('rechnet nach dem Abgleich in Serverzeit um', () => {
    const clock = createClock()
    clock.ingest({ c0: 1_000, s: 5_050, c1: 1_100 })

    expect(clock.synced).toBe(true)
    expect(clock.toServerTime(2_000)).toBe(6_000)
  })

  it('verbessert sich, wenn eine schnellere Runde nachkommt', () => {
    const clock = createClock()
    clock.ingest({ c0: 0, s: 1_000, c1: 800 })
    expect(clock.estimate?.rttMs).toBe(800)

    clock.ingest({ c0: 2_000, s: 3_020, c1: 2_040 })
    expect(clock.estimate?.rttMs).toBe(40)
  })

  it('verwirft unplausible Runden', () => {
    const clock = createClock({ maxAcceptableRttMs: 2_000 })

    clock.ingest({ c0: 0, s: 100, c1: 10_000 }) // zu lange unterwegs
    clock.ingest({ c0: 5_000, s: 100, c1: 4_000 }) // Uhr wurde mittendrin verstellt

    expect(clock.synced).toBe(false)
  })

  it('behält nur die letzten Runden im Blick', () => {
    // Sonst würde eine sehr schnelle Runde von vor einer Stunde ewig gewinnen und
    // die zwischenzeitliche Drift des Geräts verdecken.
    const clock = createClock({ maxSamples: 2 })

    clock.ingest({ c0: 0, s: 1_000, c1: 10 }) // sehr schnell, aber alt
    clock.ingest({ c0: 100, s: 1_200, c1: 300 })
    clock.ingest({ c0: 400, s: 1_600, c1: 700 })

    expect(clock.estimate?.rttMs).toBe(200)
  })

  it('setzt sich zurück', () => {
    const clock = createClock()
    clock.ingest({ c0: 1_000, s: 5_050, c1: 1_100 })
    clock.reset()

    expect(clock.synced).toBe(false)
    expect(clock.estimate).toBeNull()
  })
})
