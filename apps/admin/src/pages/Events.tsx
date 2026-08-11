import { ApiError, type EventSummary } from '@comatch/core'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

export function Events(): React.ReactElement {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchive, setShowArchive] = useState(false)

  useEffect(() => {
    api.admin
      .listEvents()
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

  async function unarchive(eventId: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.admin.updateEvent(eventId, { archived: false })
      setEvents((current) =>
        (current ?? []).map((event) => (event.id === eventId ? result.event : event)),
      )
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.')
    } finally {
      setBusy(false)
    }
  }

  const active = events?.filter((event) => !event.archivedAt) ?? []
  const archived = events?.filter((event) => event.archivedAt) ?? []

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

      {active.length > 0 && (
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
              {active.map((event) => (
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

      {events && active.length === 0 && archived.length > 0 && (
        <div className="card">
          <p className="muted">Alle Events sind archiviert.</p>
        </div>
      )}

      {archived.length > 0 && (
        <>
          <div>
            <button className="btn btn--ghost" onClick={() => setShowArchive((open) => !open)}>
              {showArchive ? 'Archiv ausblenden' : `Archiv anzeigen (${archived.length})`}
            </button>
          </div>

          {showArchive && (
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Adresse</th>
                    <th>Archiviert</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {archived.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link className="muted" to={`/events/${event.id}`}>
                          {event.name}
                        </Link>
                      </td>
                      <td className="mono muted">/e/{event.slug}</td>
                      <td className="small muted">
                        {event.archivedAt
                          ? new Date(event.archivedAt).toLocaleDateString('de-DE')
                          : '—'}
                      </td>
                      <td>
                        <button
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() => void unarchive(event.id)}
                        >
                          Reaktivieren
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
