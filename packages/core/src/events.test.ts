import { describe, expect, it } from 'vitest'
import { confirmChoosePayloadSchema, confirmRequestPayloadSchema } from './events.js'

describe('confirmRequestPayloadSchema', () => {
  it('lehnt ein leeres Paar ab', () => {
    expect(confirmRequestPayloadSchema.safeParse({ pairId: '' }).success).toBe(false)
  })
})

describe('confirmChoosePayloadSchema', () => {
  it('nimmt einen Code samt Paar an', () => {
    expect(confirmChoosePayloadSchema.parse({ pairId: 'p1', code: 'Tango 47' })).toEqual({
      pairId: 'p1',
      code: 'Tango 47',
    })
  })

  it('lehnt einen leeren oder überlangen Code ab', () => {
    expect(confirmChoosePayloadSchema.safeParse({ pairId: 'p1', code: '' }).success).toBe(false)
    expect(
      confirmChoosePayloadSchema.safeParse({ pairId: 'p1', code: 'x'.repeat(41) }).success,
    ).toBe(false)
  })
})
