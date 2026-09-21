/**
 * Leitet aus den wenigen Eingaben eines {@link EventDesign} alle Farben der Oberfläche
 * ab — und nimmt dem Admin dabei die Entscheidungen ab, die schiefgehen können.
 *
 * Es gibt bewusst keine Fehlermeldung „Kontrast zu gering": Eine unlesbare Eingabe
 * wird still korrigiert, und {@link Theme.adjustments} sagt dem Editor, was sich
 * geändert hat. Wer ein Event vorbereitet, soll keine WCAG-Tabellen lesen müssen.
 */

import { contrastRatio, hexToOklch, oklchToHex, shiftLightnessUntil, type Hex } from './color.js'
import type { CornerChoice, EventDesign, FontChoice, LogoTone } from './design.js'

/**
 * Fließtext gegen die ungünstigste Fläche. 7:1 statt der üblichen 4,5:1, weil ein
 * Beamer und ein Handy im Scheinwerferlicht beide sichtbar Kontrast verlieren.
 */
export const MIN_TEXT_CONTRAST = 7
/** Nebentext und farbige Schrift (Fehlermeldung, Knopfbeschriftung). */
export const MIN_SECONDARY_CONTRAST = 4.5
/** Farbflächen und Bedienelemente ohne Text, nach WCAG 1.4.11. */
export const MIN_UI_CONTRAST = 3

/**
 * Ab dieser Helligkeit gilt ein Hintergrund als hell. Die Grenze liegt absichtlich
 * über der Mitte: Ein kräftiges Markenrot wird lieber zu einem tiefen Rot mit weißer
 * Schrift abgedunkelt als zu Rosa aufgehellt — und Events sind meist abgedunkelt.
 */
const LIGHT_SCHEME_FROM = 0.65

const INK_LIGHT: Hex = '#ffffff'
const INK_DARK: Hex = '#06080c'

/** Statusfarben sind nicht wählbar: Grün heißt „gefunden", Rot heißt „Fehler" — in jedem Design. */
const STATUS_COLORS = {
  dark: { success: '#38d39f', danger: '#ff5c72', warn: '#ffc75b' },
  light: { success: '#0f7a55', danger: '#c4253d', warn: '#8a5a00' },
} as const

const CORNER_SCALE: Record<CornerChoice, number> = { sharp: 0.25, soft: 1, round: 1.6 }

/**
 * Nur Schriften, die das Gerät mitbringt. Eine Webschrift müsste jedes Handy im Saal
 * über dasselbe überlastete WLAN laden — und ein fremdes Font-CDN bekäme dabei die
 * IP-Adressen aller Gäste. `null` lässt den Stack der jeweiligen `styles.css` stehen.
 */
const CSS_FONT_STACKS: Record<FontChoice, string | null> = {
  system: null,
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif",
  rounded:
    "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', system-ui, sans-serif",
}

export type ThemeScheme = 'dark' | 'light'

export interface ThemeColors {
  bg: Hex
  surface: Hex
  surface2: Hex
  border: Hex
  text: Hex
  muted: Hex
  accent: Hex
  accentInk: Hex
  success: Hex
  successInk: Hex
  danger: Hex
  warn: Hex
}

/** Eine Eingabe, die für die Lesbarkeit verändert wurde. */
export interface ThemeAdjustment {
  input: 'background' | 'accent'
  from: Hex
  to: Hex
}

export interface Theme {
  scheme: ThemeScheme
  colors: ThemeColors
  /** Faktor auf die Eckenradien der jeweiligen Oberfläche — jede hat ihre eigenen Grundmaße. */
  cornerScale: number
  font: FontChoice
  adjustments: ThemeAdjustment[]
}

/** Die drei Flächenstufen über einem Hintergrund: Karte, Eingabefeld, Rahmen. */
function surfacesOf(bg: Hex, scheme: ThemeScheme): { surface: Hex; surface2: Hex; border: Hex } {
  const base = hexToOklch(bg)
  // Graue Hintergründe bleiben grau; getönte werden mit jeder Stufe etwas farbiger.
  const tint = base.c > 0.004 ? 0.01 : 0

  if (scheme === 'dark') {
    // Nahe Schwarz sind gleiche Schritte kaum zu sehen — die Karte braucht eine Mindesthelligkeit.
    const surfaceL = Math.max(base.l + 0.05, 0.17)
    return {
      surface: oklchToHex({ ...base, l: surfaceL, c: base.c + tint }),
      surface2: oklchToHex({ ...base, l: surfaceL + 0.05, c: base.c + 2 * tint }),
      border: oklchToHex({ ...base, l: surfaceL + 0.1, c: base.c + 3 * tint }),
    }
  }

  return {
    surface: oklchToHex({ ...base, l: base.l - 0.03 }),
    surface2: oklchToHex({ ...base, l: base.l - 0.06 }),
    border: oklchToHex({ ...base, l: base.l - 0.13 }),
  }
}

/** Beschriftung auf einer Farbfläche: Weiß oder fast Schwarz, je nachdem, was besser trägt. */
function inkOn(fill: Hex): Hex {
  return contrastRatio(INK_LIGHT, fill) >= contrastRatio(INK_DARK, fill) ? INK_LIGHT : INK_DARK
}

export function deriveTheme(design: EventDesign): Theme {
  const adjustments: ThemeAdjustment[] = []
  const input = hexToOklch(design.background)
  const scheme: ThemeScheme = input.l >= LIGHT_SCHEME_FROM ? 'light' : 'dark'

  // Die Schrift nimmt einen Hauch vom Farbton des Hintergrunds mit — reines Weiß wirkt hart.
  const text = oklchToHex(
    scheme === 'dark'
      ? { l: 0.96, c: Math.min(input.c, 0.008), h: input.h }
      : { l: 0.17, c: Math.min(input.c, 0.015), h: input.h },
  )
  /** Dorthin weichen Farben aus, die lesbar werden müssen: weg vom Hintergrund, hin zur Schrift. */
  const towardText = scheme === 'dark' ? 1 : 0
  const awayFromText = scheme === 'dark' ? 0 : 1

  /*
   * Gemessen wird gegen das Eingabefeld (`surface2`): Es liegt der Schrift am nächsten.
   * Hält der Kontrast dort, hält er auf Karte und Hintergrund erst recht. Ein
   * Hintergrund mittlerer Helligkeit erreicht das mit keiner Schriftfarbe — er wird
   * zur näheren Seite geschoben.
   */
  const bg = shiftLightnessUntil(
    design.background,
    awayFromText,
    (candidate) => contrastRatio(text, surfacesOf(candidate, scheme).surface2) >= MIN_TEXT_CONTRAST,
  )
  if (bg !== design.background) {
    adjustments.push({ input: 'background', from: design.background, to: bg })
  }

  const { surface, surface2, border } = surfacesOf(bg, scheme)

  const against = (min: number) => (candidate: Hex) => contrastRatio(candidate, surface2) >= min

  const textL = hexToOklch(text).l
  const bgOklch = hexToOklch(bg)
  const muted = shiftLightnessUntil(
    oklchToHex({
      l: textL + (bgOklch.l - textL) * 0.35,
      c: Math.min(bgOklch.c + 0.02, 0.04),
      h: bgOklch.h,
    }),
    towardText,
    against(MIN_SECONDARY_CONTRAST),
  )

  /**
   * Eine Farbfläche mit Beschriftung: sichtbar gegen die Flächen, lesbar beschriftet.
   * Beide Korrekturen schieben in dieselbe Richtung, die zweite hebt die erste nie auf.
   */
  const fill = (color: Hex, min: number): Hex => {
    const visible = shiftLightnessUntil(color, towardText, against(min))
    return shiftLightnessUntil(
      visible,
      towardText,
      (candidate) => contrastRatio(inkOn(candidate), candidate) >= MIN_SECONDARY_CONTRAST,
    )
  }

  const accent = fill(design.accent, MIN_UI_CONTRAST)
  if (accent !== design.accent) {
    adjustments.push({ input: 'accent', from: design.accent, to: accent })
  }

  const status = STATUS_COLORS[scheme]
  const success = fill(status.success, MIN_UI_CONTRAST)

  return {
    scheme,
    colors: {
      bg,
      surface,
      surface2,
      border,
      text,
      muted,
      accent,
      accentInk: inkOn(accent),
      success,
      successInk: inkOn(success),
      // Rot steht als Schrift in der Fehlermeldung, nicht nur als Fläche.
      danger: shiftLightnessUntil(status.danger, towardText, against(MIN_SECONDARY_CONTRAST)),
      warn: shiftLightnessUntil(status.warn, towardText, against(MIN_UI_CONTRAST)),
    },
    cornerScale: CORNER_SCALE[design.corners],
    font: design.font,
    adjustments,
  }
}

/**
 * Die abgeleiteten Farben als CSS-Variablen — dieselben Namen, die `styles.css` in
 * Teilnehmer-App und Admin-App schon benutzt. Nur Zeichenketten, kein DOM: Das
 * Setzen übernimmt die jeweilige Oberfläche.
 */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const { colors } = theme
  const font = CSS_FONT_STACKS[theme.font]
  return {
    '--bg': colors.bg,
    '--surface': colors.surface,
    '--surface-2': colors.surface2,
    '--border': colors.border,
    '--text': colors.text,
    '--muted': colors.muted,
    '--accent': colors.accent,
    '--accent-ink': colors.accentInk,
    '--success': colors.success,
    '--success-ink': colors.successInk,
    '--danger': colors.danger,
    '--warn': colors.warn,
    '--corner-scale': String(theme.cornerScale),
    ...(font ? { '--font': font } : {}),
  }
}

export type LogoPlate = 'none' | 'light' | 'dark'

/**
 * Ein dunkles Logo verschwindet auf dunklem Grund — dann bekommt es eine helle
 * Plakette, statt dass der Admin eine zweite Logo-Variante besorgen muss. Logos mit
 * hellen und dunklen Teilen sind fast immer für Weiß gezeichnet.
 */
export function logoPlateFor(scheme: ThemeScheme, tone: LogoTone): LogoPlate {
  if (scheme === 'dark') return tone === 'light' ? 'none' : 'light'
  return tone === 'light' ? 'dark' : 'none'
}
