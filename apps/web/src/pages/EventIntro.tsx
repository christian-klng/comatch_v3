import type { EventPublic } from '@comatch/core'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { useT } from '../i18n/I18nProvider.js'
import { loadSession } from '../session.js'

/**
 * Erster Bildschirm nach dem Scan.
 *
 * Wer schon eine Session für dieses Event hat, wird direkt durchgereicht — beim
 * zweiten Scan oder nach einem Reload will niemand das Onboarding erneut sehen.
 */
export function EventIntro(): React.ReactElement {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const t = useT()
  const [event, setEvent] = useState<EventPublic | null>(null)
  const [notFound, setNotFound] = useState(false)

  const existing = loadSession(slug)

  useEffect(() => {
    if (existing) return
    let cancelled = false

    api
      .getEvent(slug)
      .then((result) => {
        if (!cancelled) setEvent(result)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })

    return () => {
      cancelled = true
    }
  }, [slug, existing])

  if (existing) return <Navigate to={`/e/${slug}/play`} replace />

  if (notFound) {
    return (
      <main className="screen screen--center">
        <div className="stack" style={{ maxWidth: 320 }}>
          <h1>{t.intro.notFoundTitle}</h1>
          <p className="muted">{t.intro.notFound}</p>
          <p className="muted small">{t.intro.askHost}</p>
        </div>
      </main>
    )
  }

  if (!event) {
    return (
      <main className="screen screen--center">
        <p className="muted">{t.common.loading}</p>
      </main>
    )
  }

  return (
    <main className="screen">
      <div className="spacer" />
      <div className="stack">
        <p className="eyebrow">{t.intro.welcome}</p>
        <h1>{event.name}</h1>
        <p className="muted">{t.intro.teaser}</p>
      </div>

      <div className="spacer" />

      <div className="stack">
        <p className="small muted">{t.intro.photoNotice}</p>
        <button className="btn btn--block" onClick={() => navigate(`/e/${slug}/join`)}>
          {t.intro.join}
        </button>
      </div>
    </main>
  )
}
