import type { EventPublic } from '@comatch/core'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.js'
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
  const [event, setEvent] = useState<EventPublic | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        if (!cancelled) setError('Dieses Event gibt es nicht (mehr).')
      })

    return () => {
      cancelled = true
    }
  }, [slug, existing])

  if (existing) return <Navigate to={`/e/${slug}/play`} replace />

  if (error) {
    return (
      <main className="screen screen--center">
        <div className="stack" style={{ maxWidth: 320 }}>
          <h1>Nicht gefunden</h1>
          <p className="muted">{error}</p>
          <p className="muted small">Frage deinen Gastgeber nach einem aktuellen QR-Code.</p>
        </div>
      </main>
    )
  }

  if (!event) {
    return (
      <main className="screen screen--center">
        <p className="muted">Einen Moment…</p>
      </main>
    )
  }

  return (
    <main className="screen">
      <div className="spacer" />
      <div className="stack">
        <p className="eyebrow">Willkommen bei</p>
        <h1>{event.name}</h1>
        <p className="muted">
          Gleich lernst du hier neue Leute kennen — mit einem kleinen Spiel, das euch
          zusammenbringt.
        </p>
      </div>

      <div className="spacer" />

      <div className="stack">
        <p className="small muted">
          Für das Spiel machst du ein Foto von dir. Es sehen nur die Teilnehmer dieses Events,
          und es wird nach dem Event automatisch gelöscht.
        </p>
        <button className="btn btn--block" onClick={() => navigate(`/e/${slug}/join`)}>
          Mitmachen
        </button>
      </div>
    </main>
  )
}
