import { describe, expect, it } from 'vitest'
import { bumpPayloadSchema, manualConfirmPayloadSchema } from './events.js'

describe('bumpPayloadSchema', () => {
  it('rundet Bruchteile von Millisekunden weg', () => {
    /*
     * Beide Zeitquellen im Client liefern Nachkommastellen: performance.timeOrigin
     * plus event.timeStamp hat Sub-Millisekunden-Auflösung, und der Uhren-Offset
     * entsteht aus einer Division durch zwei. Die Spalte in der Datenbank ist ein
     * bigint — ungerundet weist Postgres jedes einzelne Signal zurück.
     */
    const parsed = bumpPayloadSchema.parse({
      pairId: 'p1',
      t: 1_785_848_641_525.5,
      magnitude: 22.4,
    })

    expect(parsed.t).toBe(1_785_848_641_526)
    expect(Number.isInteger(parsed.t)).toBe(true)
    // Die Stärke landet in einer real-Spalte und darf ihre Genauigkeit behalten.
    expect(parsed.magnitude).toBe(22.4)
  })

  it('rundet auch bei der manuellen Bestätigung', () => {
    const parsed = manualConfirmPayloadSchema.parse({ pairId: 'p1', t: 1_000.4 })
    expect(parsed.t).toBe(1_000)
  })

  it('lehnt unbrauchbare Zeitstempel ab', () => {
    expect(bumpPayloadSchema.safeParse({ pairId: 'p1', t: NaN, magnitude: 20 }).success).toBe(false)
    expect(
      bumpPayloadSchema.safeParse({ pairId: 'p1', t: Infinity, magnitude: 20 }).success,
    ).toBe(false)
  })

  it('lehnt eine negative Stärke ab', () => {
    expect(bumpPayloadSchema.safeParse({ pairId: 'p1', t: 1_000, magnitude: -1 }).success).toBe(
      false,
    )
  })

  it('lehnt ein leeres Paar ab', () => {
    expect(bumpPayloadSchema.safeParse({ pairId: '', t: 1_000, magnitude: 20 }).success).toBe(false)
  })
})
