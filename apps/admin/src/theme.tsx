import {
  deriveTheme,
  logoPlateFor,
  themeCssVariables,
  type EventDesign,
  type EventLogo as EventLogoData,
  type Theme,
  type ThemeScheme,
} from '@comatch/core'
import { useEffect, useMemo } from 'react'
import { resolveMediaUrl } from './api.js'

/**
 * Das Eventdesign in der Admin-App. Es gilt nur an zwei Stellen: auf der Leinwand und
 * in der Vorschau des Design-Editors. Die Steuerung behält immer das Comatch-Design —
 * wer zwischen zwei Events wechselt, soll sich nicht jedes Mal neu zurechtfinden.
 */

const DEFAULT_SCHEME: ThemeScheme = 'dark'

export function useTheme(design: EventDesign | null): Theme | null {
  return useMemo(() => (design ? deriveTheme(design) : null), [design])
}

/** Als `style` für einen Container: Das Design gilt dann nur darin — so arbeitet die Vorschau. */
export function themeStyle(theme: Theme | null): React.CSSProperties {
  if (!theme) return {}
  return { ...themeCssVariables(theme), colorScheme: theme.scheme } as React.CSSProperties
}

/**
 * Legt das Design auf die ganze Seite, solange die Leinwand läuft.
 *
 * Am `<html>`-Element statt an einem Container: Der Seitenhintergrund gehört dem
 * `body`, und die QR-Lightbox liegt über allem — beides soll mitgefärbt sein.
 */
export function useScreenDesign(design: EventDesign | null, active: boolean): ThemeScheme {
  const theme = useTheme(active ? design : null)

  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    const variables = themeCssVariables(theme)

    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
    root.style.setProperty('color-scheme', theme.scheme)

    return () => {
      for (const name of Object.keys(variables)) root.style.removeProperty(name)
      root.style.removeProperty('color-scheme')
    }
  }, [theme])

  return theme?.scheme ?? DEFAULT_SCHEME
}

/**
 * Das Logo des Events. Verschwände es auf dem Hintergrund — ein dunkles Logo auf
 * dunklem Grund —, bekommt es von selbst eine Plakette.
 */
export function EventLogo({
  logo,
  scheme,
  eventName,
}: {
  logo: EventLogoData | null
  scheme: ThemeScheme
  eventName: string
}): React.ReactElement | null {
  if (!logo) return null

  const plate = logoPlateFor(scheme, logo.tone)
  return (
    <div className={plate === 'none' ? 'event-logo' : `event-logo event-logo--plate-${plate}`}>
      <img src={resolveMediaUrl(logo.url) ?? ''} alt={eventName} />
    </div>
  )
}
