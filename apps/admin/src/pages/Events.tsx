import { ApiError, type EventSummary } from '@comatch/core'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

export function Events(): React.ReactElement {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .admin.listEvents()
      .then((result) => setEvents(result.events))
      .catch(() => setError('Die Events konnten nicht geladen werden.'))
  }, [])

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim()) return

    setBusy(true)
    setError(null)
    try {
      const result = await api.admin.createEvent({ name: name.trim() })
      setEvents((current) => [result.event, ...(current ?? [])])
      setName('')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Anlegen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h1>Events</h1>

      {error && <p className="notice notice--error">{error}</p>}

      <form className="card row" onSubmit={(event) => void create(event)}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Name des Events"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
        />
        <button className="btn" disabled={busy || !name.trim()}>
          Event anlegen
        </button>
      </form>

      {events === null && <p className="muted">Einen Moment…</p>}

      {events?.length === 0 && (
        <div className="card">
          <p className="muted">
            Noch kein Event. Lege oben eines an — danach bekommst du den QR-Code zum Aushängen.
          </p>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Adresse</th>
                <th>Angelegt</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link to={`/events/${event.id}`}>{event.name}</Link>
                  </td>
                  <td className="mono muted">/e/{event.slug}</td>
                  <td className="small muted">
                    {event.startsAt ? new Date(event.startsAt).toLocaleDateString('de-DE') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
