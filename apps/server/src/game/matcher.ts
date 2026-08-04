/**
 * Paarbildung für „Find me".
 *
 * Bewusst als reine Funktion ohne Datenbank: Die Regeln (nicht zweimal dieselbe
 * Person, ungerade Anzahl verkraften, keine Bevorzugung durch Beitrittsreihenfolge)
 * sind das Herz des Spiels und müssen ohne laufendes Postgres testbar sein.
 */

/** Stabiler Schlüssel für ein Paar, unabhängig von der Reihenfolge. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export interface PairingResult {
  pairs: Array<[string, string]>
  /** Bleibt bei ungerader Anzahl übrig und wartet auf den nächsten Takt. */
  unpaired: string[]
}

/** Fisher-Yates mit eingespeistem Zufall, damit Tests reproduzierbar bleiben. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

/**
 * Paart die wartenden Teilnehmer.
 *
 * Zuerst gemischt, damit die Beitrittsreihenfolge niemanden bevorzugt und die
 * Wartebank bei ungerader Anzahl reihum geht.
 *
 * Dann kommt **die am stärksten eingeschränkte Person zuerst dran** — also die mit
 * den wenigsten noch unbekannten Partnern. Reihum-greedy wäre kurzsichtig: Bei
 * [c, d, a, b] griffe sich c das freie d, und a, das nur noch d als frische Option
 * hatte, bliebe auf einer Wiederholung sitzen — obwohl c–b und a–d beide frisch
 * gewesen wären. Später im Spiel, wenn sich ohnehin schon alle halb kennen, macht
 * dieser Unterschied den Großteil der Begegnungen aus. Genau darum geht es im Spiel.
 *
 * Als Partner wird ebenfalls die eingeschränkteste frische Person gewählt, damit den
 * übrigen möglichst viele Möglichkeiten erhalten bleiben. Bleibt für jemanden gar
 * nichts Frisches übrig, gibt es eine Wiederholung — ein zweites Treffen ist besser
 * als eine Runde auf der Bank.
 *
 * @param seen Schlüssel bereits bestätigter Paare, siehe {@link pairKey}.
 */
export function buildPairs(
  candidates: readonly string[],
  seen: ReadonlySet<string>,
  random: () => number = Math.random,
): PairingResult {
  const order = shuffle(candidates, random)
  // Rang in der gemischten Reihenfolge: löst Gleichstände zufällig statt alphabetisch.
  const rank = new Map(order.map((id, index) => [id, index]))

  // Wer ist für wen noch neu? Einmal aufgebaut und danach nur noch abgetragen.
  const fresh = new Map<string, Set<string>>(order.map((id) => [id, new Set<string>()]))
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      const a = order[i]!
      const b = order[j]!
      if (seen.has(pairKey(a, b))) continue
      fresh.get(a)!.add(b)
      fresh.get(b)!.add(a)
    }
  }

  const remaining = new Set(order)
  const pairs: Array<[string, string]> = []

  /** Kleinste Zahl frischer Partner gewinnt, bei Gleichstand der frühere Rang. */
  const mostConstrained = (ids: Iterable<string>): string | null => {
    let best: string | null = null
    let bestDegree = Number.POSITIVE_INFINITY
    for (const id of ids) {
      const degree = fresh.get(id)!.size
      if (degree < bestDegree || (degree === bestDegree && rank.get(id)! < rank.get(best!)!)) {
        best = id
        bestDegree = degree
      }
    }
    return best
  }

  while (remaining.size >= 2) {
    const a = mostConstrained(remaining)!
    remaining.delete(a)

    const freshForA = [...fresh.get(a)!].filter((id) => remaining.has(id))
    const b = freshForA.length > 0 ? mostConstrained(freshForA)! : mostConstrained(remaining)!
    remaining.delete(b)

    pairs.push([a, b])

    // Beide aus den Merklisten der Übrigen entfernen, damit die Grade stimmen.
    for (const id of remaining) {
      const set = fresh.get(id)!
      set.delete(a)
      set.delete(b)
    }
  }

  return { pairs, unpaired: [...remaining] }
}
