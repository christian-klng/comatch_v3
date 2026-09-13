import {
  ApiError,
  FALLBACK_LOCALE,
  MESSAGES,
  errorMessage,
  resolveLocale,
  type Locale,
  type Messages,
} from '@comatch/core'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

interface I18nContextValue {
  locale: Locale
  t: Messages
  /** Sprache des Events, in dem man gerade ist — `null` außerhalb eines Events. */
  setEventLocale(locale: Locale | null): void
}

const I18nContext = createContext<I18nContextValue | null>(null)

/**
 * Die Sprachen des Browsers, einmal beim Start gelesen.
 *
 * `?lang=fr` ersetzt sie für diesen Tab — wie `?simulateBump=1` ein Hilfsmittel zum
 * Prüfen: Ein Browser, der Deutsch oder Englisch spricht, bekäme die Eventsprache sonst
 * nie zu sehen.
 */
function browserLanguages(): readonly string[] {
  const override = new URLSearchParams(location.search).get('lang')
  if (override) return override.split(',')
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language]
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [preferred] = useState(browserLanguages)
  const [eventLocale, setEventLocale] = useState<Locale | null>(null)

  const locale = resolveLocale(preferred, eventLocale ?? FALLBACK_LOCALE)

  // Für Screenreader und Silbentrennung — index.html kennt die Sprache noch nicht.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: MESSAGES[locale], setEventLocale }),
    [locale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n muss innerhalb von <I18nProvider> stehen.')
  return value
}

export function useT(): Messages {
  return useI18n().t
}

/**
 * Ein gescheiterter API-Aufruf als Text. Antwortet der Server, zählt sein Fehlercode;
 * ohne Antwort — Funkloch, Server weg — gilt `fallback`.
 */
export function describeError(t: Messages, cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? errorMessage(t, cause.code) : fallback
}
