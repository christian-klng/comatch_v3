import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToOklch, oklchToHex, relativeLuminance, type Hex } from './color.js'
import { DESIGN_PRESETS, eventDesignSchema, type EventDesign } from './design.js'
import {
  MIN_SECONDARY_CONTRAST,
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  deriveTheme,
  logoPlateFor,
  themeCssVariables,
} from './derive.js'

function design(background: Hex, accent: Hex): EventDesign {
  return { v: 1, background, accent, font: 'system', corners: 'soft' }
}

/** Kleiner, fester Zufallsgenerator — ein fehlgeschlagener Lauf muss sich wiederholen lassen. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomHex(random: () => number): Hex {
  const value = Math.floor(random() * 0x1000000)
  return `#${value.toString(16).padStart(6, '0')}`
}

/** Alle Zusagen, die ein abgeleitetes Design halten muss — egal, was hineinging. */
function expectReadable(input: EventDesign): void {
  const { colors } = deriveTheme(input)
  const label = `${input.background} / ${input.accent}`

  for (const area of [colors.bg, colors.surface, colors.surface2]) {
    expect(contrastRatio(colors.text, area), `Text auf ${area} (${label})`).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    )
    expect(contrastRatio(colors.muted, area), `Nebentext (${label})`).toBeGreaterThanOrEqual(
      MIN_SECONDARY_CONTRAST,
    )
    expect(contrastRatio(colors.danger, area), `Fehlertext (${label})`).toBeGreaterThanOrEqual(
      MIN_SECONDARY_CONTRAST,
    )
    for (const mark of [colors.accent, colors.success, colors.warn]) {
      expect(contrastRatio(mark, area), `Farbfläche ${mark} (${label})`).toBeGreaterThanOrEqual(
        MIN_UI_CONTRAST,
      )
    }
  }

  expect(
    contrastRatio(colors.accentInk, colors.accent),
    `Knopfbeschriftung (${label})`,
  ).toBeGreaterThanOrEqual(MIN_SECONDARY_CONTRAST)
  expect(
    contrastRatio(colors.successInk, colors.success),
    `Beschriftung auf Grün (${label})`,
  ).toBeGreaterThanOrEqual(MIN_SECONDARY_CONTRAST)
}

describe('Farbrechnung', () => {
  it('rechnet den Kontrast nach WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3)
  })

  it('kommt über OKLCH wieder beim selben Hex-Wert an', () => {
    for (const hex of ['#000000', '#ffffff', '#5b8cff', '#e30613', '#38d39f', '#808080']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex)
    }
  })

  it('nimmt bei nicht darstellbaren Farben die Buntheit zurück, nicht den Farbton', () => {
    const blue = hexToOklch('#0000ff')
    const pale = hexToOklch(oklchToHex({ ...blue, l: 0.95 }))
    expect(pale.c).toBeLessThan(blue.c)
    expect(Math.abs(pale.h - blue.h)).toBeLessThan(0.15)
  })
})

describe('deriveTheme', () => {
  it('hält jede Kontrastzusage für beliebige Eingaben', () => {
    const random = mulberry32(20260921)
    for (let i = 0; i < 1500; i += 1) {
      expectReadable(design(randomHex(random), randomHex(random)))
    }
  })

  it('hält sie auch an den Rändern', () => {
    const edges = ['#000000', '#ffffff', '#808080', '#777777', '#ff0000', '#ffff00', '#0000ff']
    for (const background of edges) {
      for (const accent of edges) expectReadable(design(background, accent))
    }
  })

  it('lässt lesbare Eingaben unverändert', () => {
    for (const preset of Object.values(DESIGN_PRESETS)) {
      const theme = deriveTheme(preset)
      expect(theme.adjustments).toEqual([])
      expect(theme.colors.bg).toBe(preset.background)
      expect(theme.colors.accent).toBe(preset.accent)
    }
  })

  it('wählt helle Schrift auf dunklem und dunkle auf hellem Grund', () => {
    const dark = deriveTheme(design('#0b0d13', '#5b8cff'))
    expect(dark.scheme).toBe('dark')
    expect(relativeLuminance(dark.colors.text)).toBeGreaterThan(0.8)

    const light = deriveTheme(design('#f7f4ee', '#c2410c'))
    expect(light.scheme).toBe('light')
    expect(relativeLuminance(light.colors.text)).toBeLessThan(0.05)
  })

  it('schiebt ein Mittelgrau zur dunklen Seite und meldet die Korrektur', () => {
    const theme = deriveTheme(design('#808080', '#5b8cff'))
    expect(theme.scheme).toBe('dark')
    expect(theme.adjustments).toContainEqual({
      input: 'background',
      from: '#808080',
      to: theme.colors.bg,
    })
    expect(relativeLuminance(theme.colors.bg)).toBeLessThan(relativeLuminance('#808080'))
  })

  it('dunkelt ein kräftiges Markenrot ab, statt es zu Rosa aufzuhellen', () => {
    const theme = deriveTheme(design('#e30613', '#ffffff'))
    expect(theme.scheme).toBe('dark')
    // Derselbe Farbton, nur dunkler.
    const hueShift = Math.abs(hexToOklch(theme.colors.bg).h - hexToOklch('#e30613').h)
    expect(hueShift).toBeLessThan(0.1)
  })

  it('hellt einen Akzent auf, der im Hintergrund versinkt — der Farbton bleibt', () => {
    const theme = deriveTheme(design('#0b0d13', '#10204a'))
    expect(theme.adjustments).toEqual([
      { input: 'accent', from: '#10204a', to: theme.colors.accent },
    ])
    const hueShift = Math.abs(hexToOklch(theme.colors.accent).h - hexToOklch('#10204a').h)
    expect(hueShift).toBeLessThan(0.1)
  })

  it('macht hell auf hell unmöglich', () => {
    const theme = deriveTheme(design('#ffffff', '#fffbe6'))
    expect(contrastRatio(theme.colors.accent, theme.colors.bg)).toBeGreaterThanOrEqual(
      MIN_UI_CONTRAST,
    )
  })

  it('liefert die CSS-Variablen, die beide Oberflächen benutzen', () => {
    const variables = themeCssVariables(deriveTheme(DESIGN_PRESETS.berry))
    expect(variables['--bg']).toBe('#1a0b18')
    expect(variables['--corner-scale']).toBe('1.6')
    expect(Object.keys(variables)).toContain('--success-ink')
  })
})

describe('logoPlateFor', () => {
  it('gibt einem Logo nur dann eine Plakette, wenn es sonst verschwände', () => {
    expect(logoPlateFor('dark', 'light')).toBe('none')
    expect(logoPlateFor('dark', 'dark')).toBe('light')
    expect(logoPlateFor('dark', 'mixed')).toBe('light')
    expect(logoPlateFor('light', 'dark')).toBe('none')
    expect(logoPlateFor('light', 'mixed')).toBe('none')
    expect(logoPlateFor('light', 'light')).toBe('dark')
  })
})

describe('eventDesignSchema', () => {
  it('vereinheitlicht die Schreibweise der Farben', () => {
    const parsed = eventDesignSchema.parse({ ...DESIGN_PRESETS.midnight, accent: ' #5B8CFF ' })
    expect(parsed.accent).toBe('#5b8cff')
  })

  it('lehnt alles ab, was keine sechsstellige Hex-Farbe ist', () => {
    for (const accent of ['#fff', 'red', '#12345g', 'url(x)', '#5b8cff; color: red']) {
      expect(eventDesignSchema.safeParse({ ...DESIGN_PRESETS.midnight, accent }).success).toBe(
        false,
      )
    }
  })
})
