import { ApiError, type EventSummary } from '@comatch/core'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { dayToEnd, dayToStart, formatDateRange } from '../dates.js'

export function Events(): React.ReactElement {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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
      const result = await api.admin.createEvent({
        name: name.trim(),
        ...eventDates(startDate, endDate),
      })
      setEvents((current) => [result.event, ...(current ?? [])])
      setName('')
      setStartDate('')
      setEndDate('')
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

      <form className="card stack" onSubmit={(event) => void create(event)}>
        <div className="row">
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
        </div>
        {/*
         * Das Datum ist mehr als Schmuck: Ab dem Ende läuft die Löschfrist für Fotos
         * und Vornamen. Ohne Datum startet sie erst mit dem Archivieren.
         */}
        <div className="row">
          <div className="field">
            <label htmlFor="startDate">Beginn</label>
            <input
              id="startDate"
              className="input"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value)
                if (!endDate || endDate < event.target.value) setEndDate(event.target.value)
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="endDate">Ende</label>
            <input
              id="endDate"
              className="input"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <p className="small muted" style={{ flex: 1, alignSelf: 'flex-end' }}>
            Nach dem Ende werden Fotos und Vornamen automatisch gelöscht. Ohne Datum beginnt die
            Frist erst mit dem Archivieren.
          </p>
        </div>
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
                <th>Datum</th>
              </tr>
            </thead>
            <tbody>
              {active.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link to={`/events/${event.id}`}>{event.name}</Link>
                  </td>
                  <td className="mono muted">/e/{event.slug}</td>
                  <td className="small muted">{formatDateRange(event)}</td>
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

/** Beginn und Ende aus den beiden Datumsfeldern; ein Ende ohne Angabe ist der Beginn. */
function eventDates(startDate: string, endDate: string): { startsAt?: string; endsAt?: string } {
  const endDay = endDate || startDate
  return {
    ...(startDate ? { startsAt: dayToStart(startDate) } : {}),
    ...(endDay ? { endsAt: dayToEnd(endDay) } : {}),
  }
}
