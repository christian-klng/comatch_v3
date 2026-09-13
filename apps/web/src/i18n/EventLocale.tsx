import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { useI18n } from './I18nProvider.js'

/**
 * Hülle um alle Seiten eines Events: holt dessen Sprache als Rückfallebene.
 *
 * Als eigene Route statt in jeder Seite, weil man auf jeder davon landen kann — nach
 * dem Scan auf der Intro, nach einem Neuladen mitten im Onboarding oder im Spiel.
 * Die Intro lädt das Event dadurch zweimal; die Anfrage ist klein, und die Seiten
 * bleiben unabhängig voneinander.
 */
export function EventLocale(): React.ReactElement {
  const { slug = '' } = useParams()
  const { setEventLocale } = useI18n()

  useEffect(() => {
    let cancelled = false

    api
      .getEvent(slug)
      .then((event) => {
        if (!cancelled) setEventLocale(event.locale)
      })
      // Ohne Event bleibt es bei der Browsersprache — den Fehler meldet die Seite selbst.
      .catch(() => undefined)

    return () => {
      cancelled = true
      setEventLocale(null)
    }
  }, [slug, setEventLocale])

  return <Outlet />
}
