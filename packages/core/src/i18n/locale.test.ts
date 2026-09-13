import { describe, expect, it } from 'vitest'
import { resolveLocale } from './locale.js'

describe('resolveLocale', () => {
  it('nimmt die Browsersprache, auch wenn das Event eine andere hat', () => {
    expect(resolveLocale(['en-US'], 'de')).toBe('en')
    expect(resolveLocale(['de-DE'], 'en')).toBe('de')
  })

  it('vergleicht nur die Hauptsprache, ohne Rücksicht auf Schreibweise', () => {
    expect(resolveLocale(['EN-gb'], 'de')).toBe('en')
    expect(resolveLocale(['de_AT'], 'en')).toBe('de')
    expect(resolveLocale([' de '], 'en')).toBe('de')
  })

  it('folgt der Reihenfolge des Browsers und überspringt Unbekanntes', () => {
    // Deutsch steht ausdrücklich in der Liste — das wiegt schwerer als die Eventsprache.
    expect(resolveLocale(['fr-CH', 'de-CH', 'en'], 'en')).toBe('de')
  })

  it('fällt auf die Eventsprache zurück, wenn der Browser keine unterstützte Sprache nennt', () => {
    expect(resolveLocale(['fr-FR', 'it'], 'en')).toBe('en')
    expect(resolveLocale(['fr-FR'], 'de')).toBe('de')
  })

  it('fällt bei leerer oder unbrauchbarer Liste zurück', () => {
    expect(resolveLocale([], 'de')).toBe('de')
    expect(resolveLocale(['', '*'], 'en')).toBe('en')
  })

  it('verwechselt ähnliche Codes nicht mit unterstützten Sprachen', () => {
    // `dsb` (Niedersorbisch) und `eo` (Esperanto) beginnen nur mit denselben Buchstaben.
    expect(resolveLocale(['dsb', 'eo'], 'en')).toBe('en')
  })
})
