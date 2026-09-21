/**
 * Farbrechnung für die Event-Designs: Kontrast nach WCAG und Helligkeit in OKLCH.
 *
 * OKLCH statt HSL, weil sich dort die Helligkeit verschieben lässt, ohne dass der
 * Farbton kippt — ein aufgehelltes Markenblau bleibt dasselbe Blau. Alles hier ist
 * reine Rechnung, damit Web, Admin und Server dieselben Ergebnisse bekommen.
 */

/** Immer sechsstellig und kleingeschrieben, etwa `#5b8cff`. */
export type Hex = string

export const HEX_PATTERN = /^#[0-9a-f]{6}$/i

export interface Oklch {
  /** Helligkeit, 0 (Schwarz) bis 1 (Weiß). */
  l: number
  /** Buntheit, 0 ist Grau. */
  c: number
  /** Farbton im Bogenmaß. */
  h: number
}

type Rgb = readonly [number, number, number]

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}

function hexToLinearRgb(hex: Hex): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    toLinear(((value >> 16) & 0xff) / 255),
    toLinear(((value >> 8) & 0xff) / 255),
    toLinear((value & 0xff) / 255),
  ]
}

function linearRgbToHex(rgb: Rgb): Hex {
  const channels = rgb.map((channel) => {
    const byte = Math.round(fromLinear(Math.min(1, Math.max(0, channel))) * 255)
    return byte.toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}

/** Relative Leuchtdichte nach WCAG 2.x. */
export function relativeLuminance(hex: Hex): number {
  const [r, g, b] = hexToLinearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Kontrastverhältnis nach WCAG, von 1 (gleich) bis 21 (Schwarz auf Weiß). */
export function contrastRatio(a: Hex, b: Hex): number {
  const ya = relativeLuminance(a)
  const yb = relativeLuminance(b)
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05)
}

export function hexToOklch(hex: Hex): Oklch {
  const [r, g, b] = hexToLinearRgb(hex)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return { l: okL, c: Math.hypot(okA, okB), h: Math.atan2(okB, okA) }
}

function oklchToLinearRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const GAMUT_TOLERANCE = 0.0005

function inGamut(rgb: Rgb): boolean {
  return rgb.every((channel) => channel >= -GAMUT_TOLERANCE && channel <= 1 + GAMUT_TOLERANCE)
}

/**
 * Sehr helle und sehr dunkle Farben können nicht beliebig bunt sein. Statt die Kanäle
 * einzeln abzuschneiden (das verschöbe den Farbton), wird die Buntheit zurückgenommen,
 * bis die Farbe darstellbar ist.
 */
export function oklchToHex(color: Oklch): Hex {
  const l = Math.min(1, Math.max(0, color.l))

  const direct = oklchToLinearRgb({ ...color, l })
  if (inGamut(direct)) return linearRgbToHex(direct)

  let low = 0
  let high = color.c
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2
    if (inGamut(oklchToLinearRgb({ l, c: mid, h: color.h }))) low = mid
    else high = mid
  }
  return linearRgbToHex(oklchToLinearRgb({ l, c: low, h: color.h }))
}

/**
 * Verschiebt die Helligkeit einer Farbe gerade so weit Richtung Schwarz (`0`) oder
 * Weiß (`1`), bis `passes` erfüllt ist — der Farbton bleibt. Erfüllt die Farbe die
 * Bedingung schon, kommt sie unverändert zurück.
 *
 * Geprüft wird immer der gerundete Hex-Wert, nicht die Zwischenrechnung: Nur der
 * landet im CSS, und die Rundung kann ein knapp bestandenes Verhältnis kippen.
 */
export function shiftLightnessUntil(
  hex: Hex,
  toward: 0 | 1,
  passes: (candidate: Hex) => boolean,
): Hex {
  if (passes(hex)) return hex

  const start = hexToOklch(hex)
  const at = (t: number): Hex => oklchToHex({ ...start, l: start.l + (toward - start.l) * t })

  // `high` besteht immer (oder ist das Ende der Skala), `low` nie.
  let low = 0
  let high = 1
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2
    if (passes(at(mid))) high = mid
    else low = mid
  }
  return at(high)
}
