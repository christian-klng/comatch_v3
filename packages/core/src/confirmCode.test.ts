import { describe, expect, it } from 'vitest'
import {
  CONFIRM_CODE_CHOICES,
  CONFIRM_CODE_WORDS,
  buildCodeChoices,
  randomConfirmCode,
} from './confirmCode.js'

/** Deterministische Zufallsquelle, damit ein Fehlschlag reproduzierbar bleibt. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

describe('randomConfirmCode', () => {
  it('besteht aus einem Wort der Liste und einer zweistelligen Zahl', () => {
    const random = seeded(1)
    for (let round = 0; round < 500; round += 1) {
      const [word, number, ...rest] = randomConfirmCode(random).split(' ')
      expect(rest).toEqual([])
      expect(CONFIRM_CODE_WORDS).toContain(word)
      expect(Number(number)).toBeGreaterThanOrEqual(10)
      expect(Number(number)).toBeLessThanOrEqual(99)
    }
  })

  it('lässt kein Wort doppelt in der Liste stehen', () => {
    expect(new Set(CONFIRM_CODE_WORDS).size).toBe(CONFIRM_CODE_WORDS.length)
  })
})

describe('buildCodeChoices', () => {
  it('enthält den richtigen Code genau einmal', () => {
    const random = seeded(7)
    for (let round = 0; round < 500; round += 1) {
      const choices = buildCodeChoices('Tango 47', new Set(['Tango 47']), random)
      expect(choices).toHaveLength(CONFIRM_CODE_CHOICES)
      expect(choices.filter((code) => code === 'Tango 47')).toHaveLength(1)
    }
  })

  it('schlägt nie den Code einer anderen Person im Event vor', () => {
    /*
     * Der eigentliche Zweck der Auswahl: Stünde dort der Code einer dritten Person,
     * sähe ein Fehlgriff aus wie eine echte Begegnung. Fast alle Codes sind hier
     * vergeben — frei sind nur die mit der Zahl 99.
     */
    const taken = new Set<string>()
    for (const word of CONFIRM_CODE_WORDS) {
      for (let number = 10; number < 99; number += 1) taken.add(`${word} ${number}`)
    }

    const random = seeded(3)
    for (let round = 0; round < 200; round += 1) {
      const choices = buildCodeChoices('Tango 47', taken, random)
      const distractors = choices.filter((code) => code !== 'Tango 47')
      expect(distractors).toHaveLength(CONFIRM_CODE_CHOICES - 1)
      for (const code of distractors) expect(taken.has(code)).toBe(false)
    }
  })

  it('unterscheidet die Vorschläge schon am Wort', () => {
    const random = seeded(11)
    for (let round = 0; round < 500; round += 1) {
      const words = buildCodeChoices('Kiwi 12', new Set(), random).map((code) => code.split(' ')[0])
      expect(new Set(words).size).toBe(CONFIRM_CODE_CHOICES)
    }
  })

  it('stellt den richtigen Code nicht immer an dieselbe Stelle', () => {
    const random = seeded(5)
    const positions = new Set<number>()
    for (let round = 0; round < 100; round += 1) {
      positions.add(buildCodeChoices('Kiwi 12', new Set(), random).indexOf('Kiwi 12'))
    }
    expect(positions.size).toBe(CONFIRM_CODE_CHOICES)
  })
})
