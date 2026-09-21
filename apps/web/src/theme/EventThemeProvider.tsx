import {
  logoPlateFor,
  type EventDesign,
  type EventLogo as EventLogoData,
  type ThemeScheme,
} from '@comatch/core'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { resolveMediaUrl } from '../api.js'
import { applyDesign, recallDesign, rememberDesign } from './applyDesign.js'

interface EventThemeValue {
  scheme: ThemeScheme
  logo: EventLogoData | null
  /** Design des Events, in dem man gerade ist — gilt sofort und wird fürs nächste Öffnen gemerkt. */
  showDesign(design: EventDesign | null): void
  showLogo(logo: EventLogoData | null): void
  /** Beim Betreten eines Events: das gemerkte Design, bis die Antwort des Servers da ist. */
  enterEvent(): void
  /** Zurück zum Comatch-Standard, ohne das gemerkte Design zu vergessen. */
  leaveEvent(): void
}

const EventThemeContext = createContext<EventThemeValue | null>(null)

/**
 * Hält fest, welches Eventdesign gerade gilt. Die Farben selbst setzt `applyDesign`
 * am `<html>`-Element; hier liegt nur, was Komponenten wissen müssen: das Logo und
 * ob der Grund hell oder dunkel ist.
 */
export function EventThemeProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  // main.tsx hat das gemerkte Design schon angewandt — hier nur denselben Stand nachziehen.
  const [scheme, setScheme] = useState<ThemeScheme>(() => applyDesign(recallDesign()))
  const [logo, setLogo] = useState<EventLogoData | null>(null)

  const showDesign = useCallback((design: EventDesign | null) => {
    setScheme(applyDesign(design))
    rememberDesign(design)
  }, [])

  const enterEvent = useCallback(() => setScheme(applyDesign(recallDesign())), [])

  const leaveEvent = useCallback(() => {
    setScheme(applyDesign(null))
    setLogo(null)
  }, [])

  const value = useMemo<EventThemeValue>(
    () => ({ scheme, logo, showDesign, showLogo: setLogo, enterEvent, leaveEvent }),
    [scheme, logo, showDesign, enterEvent, leaveEvent],
  )

  return <EventThemeContext.Provider value={value}>{children}</EventThemeContext.Provider>
}

export function useEventTheme(): EventThemeValue {
  const value = useContext(EventThemeContext)
  if (!value) throw new Error('useEventTheme muss innerhalb von <EventThemeProvider> stehen.')
  return value
}

/**
 * Das Logo des Events, falls es eines hat. Verschwände es auf dem Hintergrund — ein
 * dunkles Logo auf dunklem Grund —, bekommt es von selbst eine Plakette.
 */
export function EventLogo({ eventName }: { eventName: string }): React.ReactElement | null {
  const { logo, scheme } = useEventTheme()
  if (!logo) return null

  const plate = logoPlateFor(scheme, logo.tone)
  return (
    <div className={plate === 'none' ? 'event-logo' : `event-logo event-logo--plate-${plate}`}>
      <img src={resolveMediaUrl(logo.url) ?? ''} alt={eventName} />
    </div>
  )
}
