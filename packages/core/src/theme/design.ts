/**
 * Das Design eines Events — bewusst nur die wenigen Entscheidungen, die ein Admin
 * wirklich treffen soll. Textfarbe, Flächen, Rahmen und Statusfarben gibt es hier
 * nicht: Die leitet {@link deriveTheme} ab, damit nie hell auf hell steht.
 */

import { z } from 'zod'
import { HEX_PATTERN, type Hex } from './color.js'

/**
 * Nur die Wahl, nicht die Schriftdatei: Im Browser steht dahinter ein CSS-Stack
 * (`themeCssVariables`), in der späteren iOS-App etwas anderes.
 */
export const FONT_CHOICES = ['system', 'serif', 'rounded'] as const
export type FontChoice = (typeof FONT_CHOICES)[number]

export const CORNER_CHOICES = ['sharp', 'soft', 'round'] as const
export type CornerChoice = (typeof CORNER_CHOICES)[number]

export interface EventDesign {
  /**
   * Version des Formats. Gespeichert werden nur diese Eingaben, nie die abgeleiteten
   * Farben — so kommt eine verbesserte Ableitung allen bestehenden Events zugute.
   */
  v: 1
  background: Hex
  accent: Hex
  font: FontChoice
  corners: CornerChoice
}

const hexSchema = z
  .string()
  .trim()
  .regex(HEX_PATTERN)
  .transform((value) => value.toLowerCase())

export const eventDesignSchema = z.object({
  v: z.literal(1),
  background: hexSchema,
  accent: hexSchema,
  font: z.enum(FONT_CHOICES),
  corners: z.enum(CORNER_CHOICES),
})

/* -------------------------------------------------------------------- Logo */

/**
 * Wie hell ein hochgeladenes Logo im Mittel ist. Der Server misst das einmal beim
 * Upload; die Oberflächen entscheiden daraus, ob das Logo eine Plakette braucht.
 * Die Werte speisen das pg-Enum `logo_tone`.
 */
export const LOGO_TONES = ['light', 'dark', 'mixed'] as const
export type LogoTone = (typeof LOGO_TONES)[number]

export interface EventLogo {
  url: string
  tone: LogoTone
}

/* ----------------------------------------------------------------- Presets */

export const DESIGN_PRESET_IDS = ['midnight', 'paper', 'forest', 'berry'] as const
export type DesignPresetId = (typeof DESIGN_PRESET_IDS)[number]

/** Eingebaute Ausgangspunkte. Ihre Namen stehen in den Wörterbüchern der Admin-App. */
export const DESIGN_PRESETS: Record<DesignPresetId, EventDesign> = {
  midnight: { v: 1, background: '#0b0d13', accent: '#5b8cff', font: 'system', corners: 'soft' },
  paper: { v: 1, background: '#f7f4ee', accent: '#c2410c', font: 'serif', corners: 'sharp' },
  forest: { v: 1, background: '#0c1712', accent: '#4ade80', font: 'system', corners: 'soft' },
  berry: { v: 1, background: '#1a0b18', accent: '#ff5ca8', font: 'rounded', corners: 'round' },
}

/**
 * Feldweise statt über JSON: Postgres sortiert die Schlüssel eines `jsonb` um, ein
 * Textvergleich hielte dasselbe Design dann für geändert.
 */
export function isSameDesign(a: EventDesign | null, b: EventDesign | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.background === b.background &&
    a.accent === b.accent &&
    a.font === b.font &&
    a.corners === b.corners
  )
}
