/**
 * Aktivierungscodes: So bestätigen zwei Personen, dass sie sich gefunden haben.
 *
 * Jede Person hat für das ganze Event einen festen Code aus Wort und zweistelliger
 * Zahl („Tango 47“). Wer bestätigen will, zeigt seinen Code; das Gegenüber wählt ihn
 * aus drei Vorschlägen. Das gelingt nur, wer das andere Handy vor Augen hat.
 *
 * Die Wörter lauten auf Deutsch und Englisch gleich. Beide Handys zeigen denselben
 * Code, auch wenn der eine Browser Deutsch und der andere Englisch spricht — eine
 * übersetzte Liste würde genau dort auseinanderlaufen.
 */

// prettier-ignore
export const CONFIRM_CODE_WORDS = [
  'Alpha', 'Atlas', 'Banjo', 'Bingo', 'Bistro', 'Bravo', 'Cello', 'Cobra', 'Condor',
  'Delta', 'Disco', 'Domino', 'Echo', 'Fjord', 'Gala', 'Hotel', 'Jaguar', 'Judo',
  'Karma', 'Kiwi', 'Koala', 'Lasso', 'Laser', 'Lava', 'Lotus', 'Mambo', 'Mango',
  'Motor', 'Ninja', 'Nova', 'Opera', 'Panda', 'Piano', 'Pixel', 'Pizza', 'Polo',
  'Puma', 'Radar', 'Radio', 'Robot', 'Rodeo', 'Safari', 'Salsa', 'Samba', 'Sierra',
  'Sofa', 'Studio', 'Sushi', 'Taco', 'Tango', 'Taxi', 'Tempo', 'Tiger', 'Tofu',
  'Turbo', 'Video', 'Yoga', 'Zebra',
] as const

/** Zweistellig heißt 10–99: Eine führende Null läse sich auf dem Handy wie ein Tippfehler. */
const MIN_NUMBER = 10
const MAX_NUMBER = 99

/** So viele Codes stehen beim Auswählen zur Wahl — genau einer davon ist richtig. */
export const CONFIRM_CODE_CHOICES = 3

/** Liefert eine Zahl in [0, 1). Austauschbar, damit sich die Auswahl im Test festnageln lässt. */
export type RandomSource = () => number

function pick<T>(items: readonly T[], random: RandomSource): T {
  return items[Math.floor(random() * items.length)]!
}

function randomNumber(random: RandomSource): number {
  return MIN_NUMBER + Math.floor(random() * (MAX_NUMBER - MIN_NUMBER + 1))
}

export function formatConfirmCode(word: string, number: number): string {
  return `${word} ${number}`
}

/** Das Wort eines Codes — für Vorschläge, die sich auf den ersten Blick unterscheiden. */
function wordOf(code: string): string {
  return code.split(' ')[0] ?? code
}

export function randomConfirmCode(random: RandomSource = Math.random): string {
  return formatConfirmCode(pick(CONFIRM_CODE_WORDS, random), randomNumber(random))
}

/**
 * Die Vorschläge für das Gegenüber: der richtige Code und zwei erfundene.
 *
 * Die erfundenen dürfen niemandem im Event gehören (`taken`). Sonst stünde neben dem
 * richtigen Code womöglich der einer dritten Person, die gerade im selben Raum ihren
 * Code hochhält — ein Fehlgriff sähe dann aus wie eine echte Begegnung. Jedes Wort
 * kommt nur einmal vor, damit sich die drei Vorschläge schon am Wort unterscheiden.
 */
export function buildCodeChoices(
  correct: string,
  taken: ReadonlySet<string>,
  random: RandomSource = Math.random,
): string[] {
  const words = new Set([wordOf(correct)])
  const choices = [correct]

  // Bei 58 Wörtern × 90 Zahlen ist ein Event nie so voll, dass die Suche hängen bliebe.
  while (choices.length < CONFIRM_CODE_CHOICES) {
    const word = pick(
      CONFIRM_CODE_WORDS.filter((candidate) => !words.has(candidate)),
      random,
    )
    const code = formatConfirmCode(word, randomNumber(random))
    if (taken.has(code)) continue
    words.add(word)
    choices.push(code)
  }

  // Fisher-Yates: Der richtige Code steht nicht verräterisch immer an derselben Stelle.
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[choices[index], choices[other]] = [choices[other]!, choices[index]!]
  }
  return choices
}
