import {
  ApiError,
  type AdminEventDetail,
  type AdminGameSummary,
  type AdminParticipantRow,
  type EventStats,
  type Game,
  type GameRunStats,
  type UpdateEventRequest,
} from '@comatch/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, resolveMediaUrl } from '../api.js'
import { QrPanel } from '../components/QrPanel.js'
import { showProjectionCountdown } from '../projection.js'

/** Takt der Live-Kacheln. Schnell genug, um dem Raum zu folgen, ohne die API zu fluten. */
const POLL_INTERVAL_MS = 3_000

/**
 * Vorlauf vor jedem weiteren Spiel. Die Zeit gehört den Teilnehmern: Wer noch im
 * Gespräch ist, wird über die Leinwand vorgewarnt, bevor ihn der Server zurück in
 * die Warteschlange holt.
 */
const NEW_GAME_COUNTDOWN_S = 20

/**
 * So viele Abrufe dürfen in Folge unbeantwortet bleiben, bevor die Seite vor veralteten
 * Zahlen warnt. Gezählt statt gemessen: Ein Tab im Hintergrund drosselt seine Timer,
 * ein Zeitvergleich schlüge beim Zurückholen fälschlich Alarm. Und ein einzelner
 * Aussetzer im Hallen-WLAN gehört nicht auf die Leinwand.
 */
const MISSED_POLLS_BEFORE_WARNING = 3

export function EventDetail(): React.ReactElement {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<AdminEventDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState(0)
  const [unansweredPolls, setUnansweredPolls] = useState(0)
  const [syncError, setSyncError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await api.admin.getEvent(id)
    setDetail(result)
    setLastSyncAt(Date.now())
    setUnansweredPolls(0)
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
      // Schon beim Absenden zählen: Eine hängende Anfrage kommt nie im catch an.
      setUnansweredPolls((count) => count + 1)
      api.admin
        .getEvent(id)
        .then((result) => {
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
          )
          setLastSyncAt(Date.now())
          setUnansweredPolls(0)
          setSyncError(null)
        })
        .catch((cause: unknown) => setSyncError(cause instanceof ApiError ? cause.message : null))
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [id, detail])

  // Ein laufender Countdown darf die Seite nicht überleben.
  useEffect(() => () => stopCountdown(), [])

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

  function stopCountdown(): void {
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    countdownTimer.current = null
    setCountdown(null)
    showProjectionCountdown(null)
  }

  /** Countdown im Dashboard und auf der Leinwand, danach startet das Spiel. */
  function beginCountdown(): void {
    let left = NEW_GAME_COUNTDOWN_S
    setCountdown(left)
    showProjectionCountdown(left)

    countdownTimer.current = setInterval(() => {
      left -= 1
      if (left > 0) {
        setCountdown(left)
        showProjectionCountdown(left)
        return
      }
      stopCountdown()
      void startGame()
    }, 1_000)
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

  async function updateEvent(patch: UpdateEventRequest): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.admin.updateEvent(id, patch)
      setDetail((current) => (current ? { ...current, event: result.event } : current))
      return true
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das hat nicht geklappt.')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error && !detail) return <p className="notice notice--error">{error}</p>
  if (!detail) return <p className="muted">Einen Moment…</p>

  const { event, activeGame, joinUrl, stats, participants, games } = detail
  const archived = event.archivedAt !== null
  const activeRun = activeGame ? games.find((game) => game.id === activeGame.id) : undefined
  const endedGames = games.filter((game) => game.state === 'ended')

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <EventTitle name={event.name} busy={busy} onSave={(name) => updateEvent({ name })} />
        <div className="row">
          <SyncStatus
            stale={unansweredPolls > MISSED_POLLS_BEFORE_WARNING}
            lastSyncAt={lastSyncAt}
            error={syncError}
          />
          {archived ? (
            <>
              <span className="badge">Archiviert</span>
              <button
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void updateEvent({ archived: false })}
              >
                Reaktivieren
              </button>
            </>
          ) : (
            <ArchiveButton busy={busy} onArchive={() => updateEvent({ archived: true })} />
          )}
        </div>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <div className="grid-2">
        <QrPanel joinUrl={joinUrl} eventName={event.name} />

        <div className="stack">
          <div className="card stack">
            <div className="card__head">
              <p className="card__title">Spiel</p>
              <span className="badge">
                <span
                  className={activeGame?.state === 'running' ? 'dot dot--live' : 'dot dot--off'}
                />
                {gameLabel(activeGame)}
              </span>
            </div>

            {!activeGame && countdown !== null && (
              <>
                <h2>Neues Spiel startet in {countdown}&thinsp;s</h2>
                <p className="muted small">
                  Der Countdown läuft auch auf der Leinwand. Danach kommen alle Teilnehmer mit Match
                  automatisch zurück in die Warteschlange.
                </p>
                <button className="btn btn--ghost" onClick={stopCountdown}>
                  Abbrechen
                </button>
              </>
            )}

            {!activeGame && countdown === null && (
              <>
                <h2>Find me</h2>
                <p className="muted small">
                  Alle 10 Sekunden werden wartende Teilnehmer zufällig verbunden. Sie sehen nur das
                  Foto ihres Partners und müssen ihn im Raum finden — bestätigt wird mit einem Stoß
                  der Handys aneinander.
                </p>
                {games.length > 0 && (
                  <p className="muted small">
                    Teilnehmer mit Match kommen nach einem Countdown von {NEW_GAME_COUNTDOWN_S}{' '}
                    Sekunden automatisch zurück in die Warteschlange.
                  </p>
                )}
                <button
                  className="btn btn--lg"
                  disabled={busy || archived}
                  onClick={() => (games.length > 0 ? beginCountdown() : void startGame())}
                >
                  {games.length > 0 ? 'Neues Spiel starten' : 'Find me starten'}
                </button>
                {archived && (
                  <p className="muted small">
                    In einem archivierten Event startet kein Spiel — erst reaktivieren.
                  </p>
                )}
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
                {activeRun && <RunStats stats={activeRun.stats} />}
                <p className="small muted">
                  Ein beendetes Spiel lässt sich nicht wieder starten — danach kannst du ein neues
                  beginnen. Solange eines läuft oder pausiert, geht kein zweites.
                </p>
              </>
            )}
          </div>

          <StatsGrid stats={stats} />
        </div>
      </div>

      {endedGames.length > 0 && <GameHistory games={games} endedGames={endedGames} />}

      <ParticipantsTable participants={participants} />
    </div>
  )
}

/** Kurz gehalten: Das Badge steht in der Spielkarte, deren Überschrift den Spielnamen schon trägt. */
function gameLabel(game: Game | null): string {
  if (!game) return 'Kein Spiel aktiv'
  if (game.state === 'running') return 'Läuft'
  if (game.state === 'paused') return 'Pausiert'
  return 'Beendet'
}

/** Der Eventname, direkt an Ort und Stelle editierbar. */
function EventTitle({
  name,
  busy,
  onSave,
}: {
  name: string
  busy: boolean
  onSave: (name: string) => Promise<boolean>
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  async function save(): Promise<void> {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) {
      setEditing(false)
      return
    }
    if (await onSave(trimmed)) setEditing(false)
  }

  if (!editing) {
    return (
      <div className="row">
        <h1>{name}</h1>
        <button
          className="btn btn--ghost"
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
        >
          Umbenennen
        </button>
      </div>
    )
  }

  return (
    <div className="row" style={{ flex: 1 }}>
      <input
        className="input"
        style={{ flex: 1, maxWidth: 420 }}
        value={draft}
        maxLength={120}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape') setEditing(false)
        }}
      />
      <button className="btn" disabled={busy || !draft.trim()} onClick={() => void save()}>
        Speichern
      </button>
      <button className="btn btn--ghost" onClick={() => setEditing(false)}>
        Abbrechen
      </button>
      <span className="small muted">Die Join-Adresse /e/… bleibt gleich.</span>
    </div>
  )
}

/** Zweistufig statt Modal: erst nach einer Rückfrage wird wirklich archiviert. */
function ArchiveButton({
  busy,
  onArchive,
}: {
  busy: boolean
  onArchive: () => Promise<boolean>
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(true)}>
        Archivieren
      </button>
    )
  }

  return (
    <>
      <button
        className="btn btn--danger"
        disabled={busy}
        onClick={() => {
          void onArchive().finally(() => setConfirming(false))
        }}
      >
        Wirklich archivieren?
      </button>
      <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
        Abbrechen
      </button>
    </>
  )
}

/**
 * Ob die Zahlen auf der Seite noch frisch sind. Das Polling läuft still — ohne diesen
 * Hinweis blieben sie bei einem Verbindungsabbruch stehen und sähen trotzdem aktuell aus.
 */
function SyncStatus({
  stale,
  lastSyncAt,
  error,
}: {
  stale: boolean
  lastSyncAt: number
  /** Meldung des Servers, falls er geantwortet hat — `null` heißt: nicht erreichbar. */
  error: string | null
}): React.ReactElement {
  if (!stale) {
    return (
      <span
        className="sync small muted"
        title={`Die Werte aktualisieren sich alle ${POLL_INTERVAL_MS / 1000} Sekunden.`}
      >
        <span className="dot dot--live" />
        Verbunden
      </span>
    )
  }

  const time = new Date(lastSyncAt).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <span
      className="badge badge--warn"
      title={error ?? 'Der Server antwortet nicht. Die Seite versucht es weiter.'}
    >
      <span className="dot dot--warn" />
      {error ? 'Abruf fehlgeschlagen' : 'Keine Verbindung'} · Stand {time}
    </span>
  )
}

/** Eventweite Zahlen — Teilnehmer gehören zum Event, nicht zu einem Spiellauf. */
function StatsGrid({ stats }: { stats: EventStats }): React.ReactElement {
  return (
    <div className="stats">
      <Stat value={stats.participantsOnline} label={`von ${stats.participantsTotal} online`} />
      <Stat value={stats.waiting} label="warten auf Zuteilung" />
      <Stat value={stats.searching} label="suchen gerade" />
    </div>
  )
}

/** Die Zahlen eines einzelnen Spiellaufs. */
function RunStats({ stats }: { stats: GameRunStats }): React.ReactElement {
  /*
   * Die Quote der manuellen Bestätigungen ist die wichtigste Zahl auf dieser Seite:
   * Sie misst, wie oft die Bump-Erkennung versagt hat. Ab einem Drittel gehören
   * Schwelle und Zeitfenster nachgezogen — deshalb hebt sie sich ab diesem Wert farblich ab.
   */
  const manualPercent = Math.round(stats.manualConfirmRatio * 100)
  const manualIsHigh = stats.matchesConfirmed >= 5 && stats.manualConfirmRatio > 0.33

  return (
    <div className="stats">
      <Stat value={stats.matchesConfirmed} label="Begegnungen" />
      <Stat
        value={
          stats.medianTimeToMatchMs === null
            ? '—'
            : `${Math.round(stats.medianTimeToMatchMs / 1000)}s`
        }
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

function GameHistory({
  games,
  endedGames,
}: {
  /** Alle Läufe (neueste zuerst) — für die fortlaufende Nummerierung. */
  games: AdminGameSummary[]
  endedGames: AdminGameSummary[]
}): React.ReactElement {
  const time = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="card">
      <p className="card__title">Bisherige Spiele ({endedGames.length})</p>
      <table className="table">
        <thead>
          <tr>
            <th>Lauf</th>
            <th>Zeitraum</th>
            <th>Begegnungen</th>
            <th>Median bis Match</th>
            <th>ohne Sensor</th>
          </tr>
        </thead>
        <tbody>
          {endedGames.map((game) => (
            <tr key={game.id}>
              <td>{games.length - games.indexOf(game)}</td>
              <td className="small muted">
                {time(game.startedAt)}–{time(game.endedAt)}
              </td>
              <td>{game.stats.matchesConfirmed}</td>
              <td>
                {game.stats.medianTimeToMatchMs === null
                  ? '—'
                  : `${Math.round(game.stats.medianTimeToMatchMs / 1000)}s`}
              </td>
              <td>
                {game.stats.matchesConfirmed === 0
                  ? '—'
                  : `${Math.round(game.stats.manualConfirmRatio * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
