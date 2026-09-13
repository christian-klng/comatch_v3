/**
 * Sprachen der Teilnehmer-Oberfläche und die Regel, welche davon jemand sieht.
 *
 * Die Erkennung selbst (`navigator.languages`) bleibt bei der Plattform — hier liegt
 * nur die Entscheidung, damit Web und spätere iOS-App dieselbe Regel anwenden.
 */

/** Die Werte speisen das pg-Enum `locale`: Eine neue Sprache erzwingt eine Migration. */
export const LOCALES = ['de', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** Neue Events starten auf Deutsch — so verhalten sich auch alle, die es schon vorher gab. */
export const DEFAULT_EVENT_LOCALE: Locale = 'de'

/**
 * Sprache, wenn weder Browser noch Event weiterhelfen — etwa auf der Startseite, die
 * zu keinem Event gehört. Englisch, weil es jemand mit einer dritten Browsersprache
 * eher liest als Deutsch.
 */
export const FALLBACK_LOCALE: Locale = 'en'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Die Browsersprachen gewinnen, in ihrer Reihenfolge; die Eventsprache greift erst,
 * wenn keine davon unterstützt wird.
 *
 * Verglichen wird nur die Hauptsprache (`de-CH` → `de`): Eine Schweizerin mit
 * `['fr-CH', 'de-CH']` liest Deutsch, auch wenn das Event auf Englisch eingestellt
 * ist — ihr Browser sagt es ausdrücklich.
 */
export function resolveLocale(preferred: readonly string[], fallback: Locale): Locale {
  for (const tag of preferred) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? ''
    if (isLocale(primary)) return primary
  }
  return fallback
}
