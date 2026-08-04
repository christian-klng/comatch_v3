import { describe, expect, it } from 'vitest'
import { buildPairs, pairKey } from './matcher.js'

/**
 * Reproduzierbarer Zufall — ein Test darf nicht mal so, mal so ausgehen.
 *
 * mulberry32 und kein einfacher LCG: Ein LCG liefert für benachbarte Seeds fast
 * dieselbe Folge. Die Tests unten laufen aber genau über Seeds 0..24, und mit einem
 * LCG würden alle 25 Durchläufe praktisch identisch mischen — der Test würde dann
 * den Generator messen statt buildPairs.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

const noHistory = new Set<string>()

describe('pairKey', () => {
  it('ist unabhängig von der Reihenfolge', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
  })
})

describe('buildPairs', () => {
  it('paart eine gerade Anzahl vollständig', () => {
    const { pairs, unpaired } = buildPairs(['a', 'b', 'c', 'd'], noHistory, seededRandom(1))

    expect(pairs).toHaveLength(2)
    expect(unpaired).toHaveLength(0)
    expect(pairs.flat().sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lässt bei ungerader Anzahl genau eine Person warten', () => {
    const { pairs, unpaired } = buildPairs(['a', 'b', 'c', 'd', 'e'], noHistory, seededRandom(7))

    expect(pairs).toHaveLength(2)
    expect(unpaired).toHaveLength(1)
    // Niemand darf doppelt vorkommen.
    expect([...pairs.flat(), ...unpaired].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('bildet ohne genug Leute keine Paare', () => {
    expect(buildPairs([], noHistory).pairs).toHaveLength(0)
    expect(buildPairs(['a'], noHistory).unpaired).toEqual(['a'])
  })

  it('meidet Kombinationen, die es schon gab', () => {
    // a kennt b und c bereits — es muss d werden.
    const seen = new Set([pairKey('a', 'b'), pairKey('a', 'c')])
    const { pairs } = buildPairs(['a', 'b', 'c', 'd'], seen, seededRandom(3))

    const withA = pairs.find((pair) => pair.includes('a'))!
    expect(withA).toContain('d')
  })

  it('erlaubt eine Wiederholung, statt jemanden auf der Bank zu lassen', () => {
    // Alle kennen sich schon. Ein zweites Treffen ist besser als keins.
    const everyone = ['a', 'b', 'c', 'd']
    const seen = new Set<string>()
    for (const x of everyone) for (const y of everyone) if (x !== y) seen.add(pairKey(x, y))

    const { pairs, unpaired } = buildPairs(everyone, seen, seededRandom(11))

    expect(pairs).toHaveLength(2)
    expect(unpaired).toHaveLength(0)
  })

  it('mischt, statt nach Beitrittsreihenfolge zu paaren', () => {
    // Ohne Mischen bekäme „a" bei jedem Takt dieselbe Person.
    const people = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const partnersOfA = new Set<string>()

    for (let seed = 0; seed < 25; seed += 1) {
      const { pairs } = buildPairs(people, noHistory, seededRandom(seed))
      const withA = pairs.find((pair) => pair.includes('p0'))
      if (withA) partnersOfA.add(withA.find((id) => id !== 'p0')!)
    }

    expect(partnersOfA.size).toBeGreaterThan(3)
  })

  it('verteilt auch die Wartebank über die Takte', () => {
    // Sonst wäre immer dieselbe Person die Übriggebliebene.
    const people = ['a', 'b', 'c', 'd', 'e']
    const benched = new Set<string>()

    for (let seed = 0; seed < 25; seed += 1) {
      benched.add(buildPairs(people, noHistory, seededRandom(seed)).unpaired[0]!)
    }

    expect(benched.size).toBeGreaterThan(1)
  })

  it('hält die Wiederholungen über einen ganzen Spielverlauf klein', () => {
    // Der eigentliche Zweck des Spiels: möglichst viele verschiedene Leute treffen.
    // 12 Personen ergeben 66 mögliche Kombinationen, jede Runde verbraucht 6 davon.
    const people = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const seen = new Set<string>()
    const random = seededRandom(2024)
    let repeats = 0

    for (let round = 0; round < 5; round += 1) {
      for (const [a, b] of buildPairs(people, seen, random).pairs) {
        if (seen.has(pairKey(a, b))) repeats += 1
        seen.add(pairKey(a, b))
      }
    }

    expect(repeats).toBe(0)
    expect(seen.size).toBe(30)
  })

  it('bleibt bei vielen Teilnehmern vollständig und überschneidungsfrei', () => {
    const people = Array.from({ length: 201 }, (_, i) => `p${i}`)
    const { pairs, unpaired } = buildPairs(people, noHistory, seededRandom(42))

    expect(pairs).toHaveLength(100)
    expect(unpaired).toHaveLength(1)
    expect(new Set([...pairs.flat(), ...unpaired]).size).toBe(201)
  })
})
