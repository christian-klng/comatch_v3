import {
  deriveTheme,
  eventDesignSchema,
  themeCssVariables,
  type EventDesign,
  type ThemeScheme,
} from '@comatch/core'

/**
 * Das Design eines Events auf die Seite legen.
 *
 * Gesetzt wird direkt am `<html>`-Element und nicht über React: Das letzte Design
 * eines Events liegt im localStorage und gilt schon, bevor die App startet — sonst
 * blitzt bei jedem Öffnen kurz das Comatch-Blau auf, bevor die Eventfarben kommen.
 */

const DEFAULT_THEME_COLOR = '#0b0d13'
const DEFAULT_SCHEME: ThemeScheme = 'dark'

let appliedVariables: string[] = []

function setThemeColor(color: string): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

/** `null` stellt das Comatch-Standarddesign aus styles.css wieder her. */
export function applyDesign(design: EventDesign | null): ThemeScheme {
  const root = document.documentElement
  for (const name of appliedVariables) root.style.removeProperty(name)
  appliedVariables = []

  if (!design) {
    root.style.removeProperty('color-scheme')
    setThemeColor(DEFAULT_THEME_COLOR)
    return DEFAULT_SCHEME
  }

  const theme = deriveTheme(design)
  const variables = themeCssVariables(theme)

  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
  appliedVariables = Object.keys(variables)

  // Formularfelder, Scrollbalken und die Tastatur des Systems folgen dem Schema.
  root.style.setProperty('color-scheme', theme.scheme)
  // Färbt die Statusleiste des Handys — sonst sitzt ein dunkler Balken über einem hellen Design.
  setThemeColor(theme.colors.bg)
  return theme.scheme
}

/* ------------------------------------------------------------ Merken je Event */

const STORAGE_KEY = 'comatch.designs'

/** Der Slug des Events, in dem man gerade ist — aus der Adresse, wie der Router ihn liest. */
function currentEventSlug(): string | null {
  const match = /^\/e\/([^/]+)/.exec(location.pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

function readAll(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Privater Modus oder beschädigter Eintrag — dann kommt das Design eben erst vom Server.
    return {}
  }
}

/** Das zuletzt gesehene Design des Events in der Adresszeile; ohne Event oder Eintrag `null`. */
export function recallDesign(): EventDesign | null {
  const slug = currentEventSlug()
  if (!slug) return null
  // Geprüft wie eine Eingabe von außen: Der Eintrag kann aus einer älteren Version stammen.
  const parsed = eventDesignSchema.safeParse(readAll()[slug])
  return parsed.success ? parsed.data : null
}

export function rememberDesign(design: EventDesign | null): void {
  const slug = currentEventSlug()
  if (!slug) return
  try {
    const all = readAll()
    if (design) all[slug] = design
    else delete all[slug]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Kein Speicher verfügbar — beim nächsten Öffnen blitzt dann kurz das Standarddesign auf.
  }
}
