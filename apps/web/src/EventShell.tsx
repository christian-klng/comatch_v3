import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { api } from './api.js'
import { useI18n } from './i18n/I18nProvider.js'
import { useEventTheme } from './theme/EventThemeProvider.js'

/**
 * Hülle um alle Seiten eines Events: holt dessen Sprache als Rückfallebene, sein
 * Design und sein Logo.
 *
 * Als eigene Route statt in jeder Seite, weil man auf jeder davon landen kann — nach
 * dem Scan auf der Intro, nach einem Neuladen mitten im Onboarding oder im Spiel.
 * Die Intro lädt das Event dadurch zweimal; die Anfrage ist klein, und die Seiten
 * bleiben unabhängig voneinander.
 */
export function EventShell(): React.ReactElement {
  const { slug = '' } = useParams()
  const { setEventLocale } = useI18n()
  const { showDesign, showLogo, enterEvent, leaveEvent } = useEventTheme()

  useEffect(() => {
    let cancelled = false
    enterEvent()

    api
      .getEvent(slug)
      .then((event) => {
        if (cancelled) return
        setEventLocale(event.locale)
        showDesign(event.design)
        showLogo(event.logo)
      })
      // Ohne Event bleibt es bei Browsersprache und gemerktem Design — den Fehler meldet
      // die Seite selbst.
      .catch(() => undefined)

    return () => {
      cancelled = true
      setEventLocale(null)
      leaveEvent()
    }
  }, [slug, setEventLocale, showDesign, showLogo, enterEvent, leaveEvent])

  return <Outlet />
}
