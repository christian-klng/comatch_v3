import {
  ApiError,
  type AdminEventDetail,
  type AdminParticipantRow,
  type Game,
  type GameStats,
} from '@comatch/core'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, resolveMediaUrl } from '../api.js'
import { QrPanel } from '../components/QrPanel.js'

/** Takt der Live-Kacheln. Schnell genug, um dem Raum zu folgen, ohne die API zu fluten. */
const POLL_INTERVAL_MS = 3_000

export function EventDetail(): React.ReactElement {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<AdminEventDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await api.admin.getEvent(id)
    setDetail(result)
  }, [id])

  useEffect(() => {
    load().catch(() => setError('Das Event konnte nicht geladen werden.'))
  }, [load])

  /*
   * Nur Kennzahlen und Teilnehmerliste nachladen statt der ganzen Seite: Sonst würde
   * der QR-Code alle drei Sekunden neu gerendert — sichtbar auf einer Leinwand.
   */
  useEffect(() => {
    if (!detail) return

    const timer = setInterval(() => {
      api.admin
        .getEvent(id)
        .then((result) =>
          setDetail((current) =>
            current
              ? {
                  ...current,
                  stats: result.stats,
                  participants: result.participants,
                  activeGame: result.activeGame,
                  games: result.games,
                }
              : result,
          ),
        )
        .catch(() => undefined)
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [id, detail])

  async function startGame(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.admin.startGame(id, { type: 'find_me' })
      await load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das Spiel ließ sich nicht starten.')
    } finally {
      setBusy(false)
    }
  }

  async function setState(game: Game, state: 'running' | 'paused' | 'ended'): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.admin.setGameState(game.id, { state })
      await load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !detail) return <p className="notice notice--error">{error}</p>
  if (!detail) return <p className="muted">Einen Moment…</p>

  const { event, activeGame, joinUrl, stats, participants } = detail

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{event.name}</h1>
        <span className="badge">
          <span className={activeGame?.state === 'running' ? 'dot dot--live' : 'dot dot--off'} />
          {gameLabel(activeGame)}
        </span>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <div className="grid-2">
        <QrPanel joinUrl={joinUrl} eventName={event.name} />

        <div className="stack">
          <div className="card stack">
            <p className="card__title">Spiel</p>

            {!activeGame && (
              <>
                <h2>Find me</h2>
                <p className="muted small">
                  Alle 10 Sekunden werden wartende Teilnehmer zufällig verbunden. Sie sehen nur
                  das Foto ihres Partners und müssen ihn im Raum finden — bestätigt wird mit
                  einem Stoß der Handys aneinander.
                </p>
                <button className="btn btn--lg" disabled={busy} onClick={() => void startGame()}>
                  Find me starten
                </button>
              </>
            )}

            {activeGame && (
              <>
                <h2>Find me läuft{activeGame.state === 'paused' ? ' (pausiert)' : ''}</h2>
                <div className="row">
                  {activeGame.state === 'running' ? (
                    <button
                      className="btn btn--ghost"
                      disabled={busy}
                      onClick={() => void setState(activeGame, 'paused')}
                    >
                      Pausieren
                    </button>
                  ) : (
                    <button
                      className="btn btn--success"
                      disabled={busy}
                      onClick={() => void setState(activeGame, 'running')}
                    >
                      Fortsetzen
                    </button>
                  )}
                  <button
                    className="btn btn--danger"
                    disabled={busy}
                    onClick={() => void setState(activeGame, 'ended')}
                  >
                    Beenden
                  </button>
                </div>
                <p className="small muted">
                  Ein beendetes Spiel lässt sich nicht wieder starten — danach kannst du ein
                  neues beginnen. Solange eines läuft oder pausiert, geht kein zweites.
                </p>
              </>
            )}
          </div>

          <StatsGrid stats={stats} />
        </div>
      </div>

      <ParticipantsTable participants={participants} />
    </div>
  )
}

function gameLabel(game: Game | null): string {
  if (!game) return 'Kein Spiel aktiv'
  if (game.state === 'running') return 'Find me läuft'
  if (game.state === 'paused') return 'Pausiert'
  return 'Beendet'
}

function StatsGrid({ stats }: { stats: GameStats }): React.ReactElement {
  /*
   * Die Quote der manuellen Bestätigungen ist die wichtigste Zahl auf dieser Seite:
   * Sie misst, wie oft die Bump-Erkennung versagt hat. Ab einem Drittel gehören
   * Schwelle und Zeitfenster nachgezogen — deshalb hebt sie sich ab diesem Wert farblich ab.
   */
  const manualPercent = Math.round(stats.manualConfirmRatio * 100)
  const manualIsHigh = stats.matchesConfirmed >= 5 && stats.manualConfirmRatio > 0.33

  return (
    <div className="stats">
      <Stat value={stats.participantsOnline} label={`von ${stats.participantsTotal} online`} />
      <Stat value={stats.waiting} label="warten auf Zuteilung" />
      <Stat value={stats.searching} label="suchen gerade" />
      <Stat value={stats.matchesConfirmed} label="Begegnungen" />
      <Stat
        value={stats.medianTimeToMatchMs === null ? '—' : `${Math.round(stats.medianTimeToMatchMs / 1000)}s`}
        label="Median bis Match"
      />
      <Stat
        value={stats.matchesConfirmed === 0 ? '—' : `${manualPercent}%`}
        label="ohne Sensor bestätigt"
        warn={manualIsHigh}
      />
    </div>
  )
}

function Stat({
  value,
  label,
  warn = false,
}: {
  value: number | string
  label: string
  warn?: boolean
}): React.ReactElement {
  return (
    <div className={warn ? 'stat stat--warn' : 'stat'}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

function ParticipantsTable({
  participants,
}: {
  participants: AdminParticipantRow[]
}): React.ReactElement {
  if (participants.length === 0) {
    return (
      <div className="card">
        <p className="card__title">Teilnehmer</p>
        <p className="muted">
          Noch niemand da. Sobald jemand den QR-Code scannt, taucht er hier auf.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <p className="card__title">Teilnehmer ({participants.length})</p>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 52 }} />
            <th>Name</th>
            <th>Zustand</th>
            <th>Begegnungen</th>
            <th>Dabei seit</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((person) => (
            <tr key={person.id}>
              <td>
                {person.photoUrl ? (
                  <img className="thumb" src={resolveMediaUrl(person.photoUrl) ?? ''} alt="" />
                ) : (
                  <div className="thumb" />
                )}
              </td>
              <td>{person.displayName}</td>
              <td>
                <span className="badge">
                  <span className={person.online ? 'dot dot--live' : 'dot dot--off'} />
                  {stateLabel(person.state)}
                </span>
              </td>
              <td>{person.matchCount}</td>
              <td className="small muted">
                {new Date(person.joinedAt).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function stateLabel(state: AdminParticipantRow['state']): string {
  switch (state) {
    case 'onboarding':
      return 'richtet ein'
    case 'waiting':
      return 'wartet'
    case 'searching':
      return 'sucht'
    case 'matched':
      return 'hat Match'
    case 'idle':
      return 'unterhält sich'
    case 'offline':
      return 'offline'
  }
}
