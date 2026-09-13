import {
  ApiError,
  LOCALES,
  type AdminEventDetail,
  type AdminGameSummary,
  type AdminMatchFeedItem,
  type AdminParticipantRow,
  type EventStats,
  type Game,
  type GameRunStats,
  type Locale,
  type UpdateEventRequest,
} from '@comatch/core'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, resolveMediaUrl } from '../api.js'
import { QrPanel } from '../components/QrPanel.js'
import { dayToEnd, formatDateTime, toDayInput } from '../dates.js'
import { useScreenMode } from '../screen.js'
import { pendingScreenTexts, screenTexts, type ScreenTexts } from '../screenTexts.js'

/** Takt der Live-Kacheln. Schnell genug, um dem Raum zu folgen, ohne die API zu fluten. */
const POLL_INTERVAL_MS = 3_000

/**
 * Während des Countdowns pollt die Seite schneller: Sonst stünde auf der Leinwand
 * nach Ablauf bis zu drei Sekunden lang „Los!", bevor das Spiel erscheint.
 */
const COUNTDOWN_POLL_INTERVAL_MS = 1_000

/**
 * Vorlauf vor jedem Spiel. Die Leinwand kündigt den Start an, und wer nach einem
 * Match noch im Gespräch ist, wird vorgewarnt, bevor ihn der Server zurück in die
 * Warteschlange holt.
 */
const START_COUNTDOWN_S = 20

/**
 * So viele Abrufe dürfen in Folge unbeantwortet bleiben, bevor die Seite vor veralteten
 * Zahlen warnt. Gezählt statt gemessen: Ein Tab im Hintergrund drosselt seine Timer,
 * ein Zeitvergleich schlüge beim Zurückholen fälschlich Alarm. Und ein einzelner
 * Aussetzer im Hallen-WLAN gehört nicht auf die Leinwand.
 */
const MISSED_POLLS_BEFORE_WARNING = 3

export function EventDetail(): React.ReactElement {
  const { id = '' } = useParams()
  const [screen, setScreen] = useScreenMode()
  const [detail, setDetail] = useState<AdminEventDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null)
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
   * Nur die Live-Teile nachladen statt der ganzen Seite: Sonst würde der QR-Code alle
   * paar Sekunden neu gerendert — sichtbar auf einer Leinwand.
   */
  useEffect(() => {
    if (!detail) return

    const timer = setInterval(
      () => {
        // Schon beim Absenden zählen: Eine hängende Anfrage kommt nie im catch an.
        setUnansweredPolls((count) => count + 1)
        api.admin
          .getEvent(id)
          .then((result) => {
            setDetail((current) =>
              current
                ? {
                    ...current,
                    // Name und Sprache ändern sich auch aus dem Steuer-Tab — die Leinwand soll
                    // das ohne Neuladen zeigen. `joinUrl` bleibt, damit der QR-Code steht.
                    event: result.event,
                    stats: result.stats,
                    participants: result.participants,
                    activeGame: result.activeGame,
                    startCountdown: result.startCountdown,
                    games: result.games,
                    recentMatches: result.recentMatches,
                  }
                : result,
            )
            setLastSyncAt(Date.now())
            setUnansweredPolls(0)
            setSyncError(null)
          })
          .catch((cause: unknown) => setSyncError(cause instanceof ApiError ? cause.message : null))
      },
      detail.startCountdown ? COUNTDOWN_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    )

    return () => clearInterval(timer)
  }, [id, detail])

  /*
   * Die Restzeit vom Server in einen lokalen Endzeitpunkt umrechnen — bei jedem Abruf,
   * aber nie nach hinten: Die Laufzeit der Anfrage ließe die Sekunden sonst ab und zu
   * zurückspringen. Weicht der Server deutlich ab, war es ein neuer Countdown.
   */
  const remainingMs = detail?.startCountdown?.remainingMs ?? null
  useEffect(() => {
    if (remainingMs === null) {
      setCountdownEndsAt(null)
      return
    }
    const next = Date.now() + remainingMs
    setCountdownEndsAt((current) =>
      current !== null && Math.abs(current - next) < 1_500 ? Math.min(current, next) : next,
    )
  }, [remainingMs])

  // Esc beendet den Leinwand-Modus — am Beamer-Rechner ist oft keine Maus zur Hand.
  useEffect(() => {
    if (!screen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, setScreen])

  /** Eine Admin-Aktion mit Sperre und Fehlermeldung; danach steht der frische Stand da. */
  async function run(action: () => Promise<unknown>, failure: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      return true
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : failure)
      return false
    } finally {
      setBusy(false)
    }
  }

  const beginCountdown = () =>
    run(
      () => api.admin.startGameCountdown(id, { type: 'find_me', seconds: START_COUNTDOWN_S }),
      'Das Spiel ließ sich nicht starten.',
    )

  const cancelCountdown = () =>
    run(() => api.admin.cancelGameCountdown(id), 'Der Countdown ließ sich nicht abbrechen.')

  const setState = (game: Game, state: 'running' | 'paused' | 'ended') =>
    run(() => api.admin.setGameState(game.id, { state }), 'Das hat nicht geklappt.')

  const updateEvent = (patch: UpdateEventRequest) =>
    run(() => api.admin.updateEvent(id, patch), 'Das hat nicht geklappt.')

  const purge = () =>
    run(() => api.admin.purgeEvent(id), 'Die Personendaten ließen sich nicht löschen.')

  const removeParticipant = (participantId: string) =>
    run(
      () => api.admin.removeParticipant(participantId),
      'Der Teilnehmer ließ sich nicht entfernen.',
    )

  if (!detail) {
    const pending = pendingScreenTexts(screen)
    if (error) return <p className="notice notice--error">{screen ? pending.loadFailed : error}</p>
    return <p className="muted">{pending.loading}</p>
  }

  const {
    event,
    activeGame,
    startCountdown,
    joinUrl,
    stats,
    participants,
    games,
    recentMatches,
    dataRetentionHours,
  } = detail
  const archived = event.archivedAt !== null
  const activeRun = activeGame ? games.find((game) => game.id === activeGame.id) : undefined
  const endedGames = games.filter((game) => game.state === 'ended')
  const counting = !activeGame && startCountdown !== null
  const texts = screenTexts(event.locale, screen)

  const gameCard = (
    <div className="card stack">
      <div className="card__head">
        <p className="card__title">{texts.game.title}</p>
        <span className="badge">
          <span className={activeGame?.state === 'running' ? 'dot dot--live' : 'dot dot--off'} />
          {gameLabel(texts, activeGame, counting)}
        </span>
      </div>

      {counting && (
        <>
          <div className="countdown" role="timer">
            <p className="countdown__label">
              {games.length > 0 ? texts.game.newGameStartsIn : texts.game.findMeStartsIn}
            </p>
            <CountdownSeconds
              endsAt={countdownEndsAt ?? Date.now() + startCountdown.remainingMs}
              go={texts.game.go}
            />
          </div>
          {games.length > 0 && <p className="muted small">{texts.game.requeueNotice}</p>}
          {!screen && (
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void cancelCountdown()}
            >
              Abbrechen
            </button>
          )}
        </>
      )}

      {!activeGame && !counting && (
        <>
          <h2>{texts.game.findMe}</h2>
          <p className="muted small">{texts.game.findMeDescription}</p>
          {!screen && (
            <>
              <p className="muted small">
                Das Spiel startet nach einem Countdown von {START_COUNTDOWN_S} Sekunden
                {games.length > 0
                  ? ' — Teilnehmer mit Match kommen dann automatisch zurück in die Warteschlange.'
                  : '.'}
              </p>
              <button
                className="btn btn--lg"
                disabled={busy || archived}
                onClick={() => void beginCountdown()}
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
        </>
      )}

      {activeGame && (
        <>
          <h2>{texts.game.findMeRunning(activeGame.state === 'paused')}</h2>
          {!screen && (
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
              <EndGameButton busy={busy} onEnd={() => setState(activeGame, 'ended')} />
            </div>
          )}
          {activeRun && <RunStats stats={activeRun.stats} screen={screen} texts={texts} />}
          {!screen && (
            <p className="small muted">
              Ein beendetes Spiel lässt sich nicht wieder starten — danach kannst du ein neues
              beginnen. Solange eines läuft oder pausiert, geht kein zweites.
            </p>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {screen ? (
          <h1>{event.name}</h1>
        ) : (
          <EventTitle name={event.name} busy={busy} onSave={(name) => updateEvent({ name })} />
        )}
        <div className="row">
          <SyncStatus
            stale={unansweredPolls > MISSED_POLLS_BEFORE_WARNING}
            lastSyncAt={lastSyncAt}
            error={syncError}
            texts={texts}
          />
          {archived && <span className="badge">{texts.archived}</span>}
          {screen ? (
            <button
              className="btn btn--ghost screen-exit"
              onClick={() => setScreen(false)}
              title={texts.screenMode.exitHint}
            >
              {texts.screenMode.exit}
            </button>
          ) : (
            <>
              <LocaleSwitch
                locale={event.locale}
                busy={busy}
                onChange={(locale) => updateEvent({ locale })}
              />
              {archived ? (
                <button
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => void updateEvent({ archived: false })}
                >
                  Reaktivieren
                </button>
              ) : (
                <ArchiveButton busy={busy} onArchive={() => updateEvent({ archived: true })} />
              )}
              <button
                className="btn btn--ghost"
                onClick={() => setScreen(true)}
                title="Blendet alles Bedienbare aus — für den Beamer. Gesteuert wird aus einem zweiten Tab; Esc beendet den Modus."
              >
                Leinwand-Modus
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      {/*
       * Steuerung: zwei Spalten, der Feed links unter dem QR-Code — dort war Platz,
       * rechts drängte er Verlauf und Teilnehmerliste nach unten. Leinwand: drei
       * Spalten, damit die neuesten Begegnungen ohne Scrollen sichtbar bleiben.
       */}
      {screen ? (
        <div className="grid-screen">
          <QrPanel joinUrl={joinUrl} eventName={event.name} locale={event.locale} screen />
          <div className="stack">
            {gameCard}
            <StatsGrid stats={stats} screen texts={texts} />
          </div>
          <MatchFeed matches={recentMatches} texts={texts} />
        </div>
      ) : (
        <div className="grid-2">
          <div className="stack">
            <QrPanel joinUrl={joinUrl} eventName={event.name} locale={event.locale} />
            <MatchFeed matches={recentMatches} texts={texts} />
          </div>
          <div className="stack">
            {gameCard}
            <StatsGrid stats={stats} texts={texts} />
          </div>
        </div>
      )}

      {/* Verlauf und Teilnehmer sind Arbeitsmaterial für den Admin, nichts für den Saal. */}
      {!screen && endedGames.length > 0 && <GameHistory games={games} endedGames={endedGames} />}

      {!screen && (
        <ParticipantsTable participants={participants} busy={busy} onRemove={removeParticipant} />
      )}

      {!screen && (
        <RetentionCard
          event={event}
          retentionHours={dataRetentionHours}
          participantCount={participants.length}
          gameActive={activeGame !== null}
          busy={busy}
          onEndsAtChange={(endsAt) => updateEvent({ endsAt })}
          onPurge={purge}
        />
      )}
    </div>
  )
}

/**
 * Wann verschwinden Fotos und Vornamen? Die Antwort steht hier, nicht in einer
 * Umgebungsvariable: Der Admin soll sehen, ob die Frist überhaupt läuft — ohne
 * Enddatum und ohne Archivierung tut sie das lange nicht.
 */
function RetentionCard({
  event,
  retentionHours,
  participantCount,
  gameActive,
  busy,
  onEndsAtChange,
  onPurge,
}: {
  event: AdminEventDetail['event']
  retentionHours: number
  /** Teilnehmer mit Personendaten — nur die lassen sich noch löschen. */
  participantCount: number
  gameActive: boolean
  busy: boolean
  onEndsAtChange: (endsAt: string | null) => Promise<boolean>
  onPurge: () => Promise<boolean>
}): React.ReactElement {
  const hours = retentionHours * 60 * 60 * 1000
  const dueAt = (() => {
    const candidates = [event.endsAt, event.archivedAt]
      .filter((iso): iso is string => iso !== null)
      .map((iso) => new Date(iso).getTime() + hours)
    return candidates.length > 0 ? Math.min(...candidates) : null
  })()

  let status: string
  if (participantCount === 0 && event.purgedAt) {
    status = `Personendaten gelöscht am ${formatDateTime(event.purgedAt)}.`
  } else if (dueAt !== null) {
    status =
      dueAt <= Date.now()
        ? 'Die Frist ist abgelaufen — der Server löscht beim nächsten Durchlauf (stündlich).'
        : `Fotos und Vornamen werden am ${formatDateTime(dueAt)} automatisch gelöscht.`
  } else {
    status = `Ohne Enddatum beginnt die Frist erst mit dem Archivieren (${retentionHours} Stunden) — oder nach drei Tagen ohne Aktivität.`
  }

  return (
    <div className="card stack">
      <p className="card__title">Löschfrist</p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label htmlFor="endsAt">Ende des Events</label>
          <input
            id="endsAt"
            className="input"
            type="date"
            defaultValue={toDayInput(event.endsAt)}
            disabled={busy}
            onChange={(change) => {
              const day = change.target.value
              void onEndsAtChange(day ? dayToEnd(day) : null)
            }}
          />
        </div>
        <p className="small muted" style={{ flex: 1 }}>
          {status}
        </p>
      </div>
      <PurgeButton
        busy={busy}
        disabled={gameActive || participantCount === 0}
        hint={
          gameActive
            ? 'Erst das laufende Spiel beenden.'
            : participantCount === 0
              ? 'Es gibt nichts mehr zu löschen.'
              : 'Fotos, Vornamen und Profile aller Teilnehmer sind danach weg; die Zahlen der Auswertung bleiben. Das Event wird dabei archiviert.'
        }
        onPurge={onPurge}
      />
    </div>
  )
}

/** Zweistufig wie das Archivieren — nur dass hier wirklich etwas verschwindet. */
function PurgeButton({
  busy,
  disabled,
  hint,
  onPurge,
}: {
  busy: boolean
  disabled: boolean
  hint: string
  onPurge: () => Promise<boolean>
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="row">
      {confirming ? (
        <>
          <button
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              void onPurge().finally(() => setConfirming(false))
            }}
          >
            Wirklich alle Personendaten löschen?
          </button>
          <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
            Abbrechen
          </button>
        </>
      ) : (
        <button
          className="btn btn--ghost"
          disabled={busy || disabled}
          onClick={() => setConfirming(true)}
        >
          Personendaten jetzt löschen
        </button>
      )}
      <span className="small muted">{hint}</span>
    </div>
  )
}

/** Zweistufig wie das Archivieren: Ein beendetes Spiel kommt nicht zurück. */
function EndGameButton({
  busy,
  onEnd,
}: {
  busy: boolean
  onEnd: () => Promise<boolean>
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(true)}>
        Beenden
      </button>
    )
  }

  return (
    <>
      <button
        className="btn btn--danger"
        disabled={busy}
        onClick={() => {
          void onEnd().finally(() => setConfirming(false))
        }}
      >
        Wirklich beenden?
      </button>
      <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
        Abbrechen
      </button>
    </>
  )
}

/** Kurz gehalten: Das Badge steht in der Spielkarte, deren Überschrift den Spielnamen schon trägt. */
function gameLabel(texts: ScreenTexts, game: Game | null, counting: boolean): string {
  if (!game) return counting ? texts.game.starting : texts.game.none
  if (game.state === 'running') return texts.game.running
  if (game.state === 'paused') return texts.game.paused
  return texts.game.ended
}

/** Die großen Sekunden. Sie ticken lokal gegen den Endzeitpunkt, den der Server vorgibt. */
function CountdownSeconds({ endsAt, go }: { endsAt: number; go: string }): React.ReactElement {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1_000))
  return <div className="countdown__seconds">{seconds > 0 ? seconds : go}</div>
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

/** Jede Sprache in ihrer eigenen Sprache benannt, wie in jeder Sprachwahl. */
const LOCALE_LABELS: Record<Locale, string> = { de: 'Deutsch', en: 'English' }

/**
 * Die Eventsprache. Ohne Rückfrage, weil sie sich jederzeit zurückstellen lässt.
 *
 * Der Hinweis im Tooltip gehört dazu: Wessen Browser Deutsch oder Englisch spricht,
 * sieht die Einstellung nie — sonst wirkte die Umstellung auf dem eigenen Handy kaputt.
 */
function LocaleSwitch({
  locale,
  busy,
  onChange,
}: {
  locale: Locale
  busy: boolean
  onChange: (locale: Locale) => Promise<boolean>
}): React.ReactElement {
  return (
    <div
      className="segmented"
      role="group"
      aria-label="Sprache des Events"
      title="Sprache der Leinwand — und für Teilnehmende, deren Browser weder Deutsch noch Englisch eingestellt hat. Alle anderen sehen ihre Browsersprache."
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          className={
            option === locale ? 'segmented__option segmented__option--active' : 'segmented__option'
          }
          aria-pressed={option === locale}
          disabled={busy}
          onClick={() => {
            if (option !== locale) void onChange(option)
          }}
        >
          {LOCALE_LABELS[option]}
        </button>
      ))}
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
  texts,
}: {
  stale: boolean
  lastSyncAt: number
  /** Meldung des Servers, falls er geantwortet hat — `null` heißt: nicht erreichbar. */
  error: string | null
  texts: ScreenTexts
}): React.ReactElement {
  if (!stale) {
    return (
      <span className="sync small muted" title={texts.sync.refreshHint(POLL_INTERVAL_MS / 1000)}>
        <span className="dot dot--live" />
        {texts.sync.connected}
      </span>
    )
  }

  const time = new Date(lastSyncAt).toLocaleTimeString(texts.timeLocale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <span className="badge badge--warn" title={error ?? texts.sync.unreachable}>
      <span className="dot dot--warn" />
      {error ? texts.sync.failed : texts.sync.offline} · {texts.sync.asOf(time)}
    </span>
  )
}

/**
 * Eventweite Zahlen — Teilnehmer gehören zum Event, nicht zu einem Spiellauf.
 * Auf der Leinwand ohne die Warteschlange: Dem Saal sagt sie nichts.
 */
function StatsGrid({
  stats,
  screen = false,
  texts,
}: {
  stats: EventStats
  screen?: boolean
  texts: ScreenTexts
}): React.ReactElement {
  return (
    <div className="stats">
      <Stat value={stats.participantsOnline} label={texts.stats.online(stats.participantsTotal)} />
      {!screen && <Stat value={stats.waiting} label="warten auf Zuteilung" />}
      <Stat value={stats.searching} label={texts.stats.searching} />
    </div>
  )
}

/** Die Zahlen eines einzelnen Spiellaufs. */
function RunStats({
  stats,
  screen = false,
  texts,
}: {
  stats: GameRunStats
  screen?: boolean
  texts: ScreenTexts
}): React.ReactElement {
  /*
   * Die Quote der manuellen Bestätigungen ist die wichtigste Zahl auf dieser Seite:
   * Sie misst, wie oft die Bump-Erkennung versagt hat. Ab einem Drittel gehören
   * Schwelle und Zeitfenster nachgezogen — deshalb hebt sie sich ab diesem Wert farblich ab.
   */
  const manualPercent = Math.round(stats.manualConfirmRatio * 100)
  const manualIsHigh = stats.matchesConfirmed >= 5 && stats.manualConfirmRatio > 0.33

  // Median und Sensorquote sind Diagnose für den Admin — auf der Leinwand zählt nur die Zahl der Begegnungen.
  if (screen) {
    return (
      <div className="stats">
        <Stat value={stats.matchesConfirmed} label={texts.stats.encounters} />
      </div>
    )
  }

  return (
    <div className="stats">
      <Stat value={stats.matchesConfirmed} label={texts.stats.encounters} />
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

/** Die jüngsten Begegnungen — auf der Leinwand der sichtbare Beweis, dass das Spiel trägt. */
function MatchFeed({
  matches,
  texts,
}: {
  matches: AdminMatchFeedItem[]
  texts: ScreenTexts
}): React.ReactElement {
  return (
    <div className="card">
      <p className="card__title">{texts.feed.title}</p>
      {matches.length === 0 ? (
        <p className="muted">{texts.feed.empty}</p>
      ) : (
        <ul className="feed">
          {matches.map((match) => (
            <li key={match.pairId} className="feed__item">
              <div className="feed__photos">
                <Photo url={match.a.photoUrl} />
                <Photo url={match.b.photoUrl} />
              </div>
              <div>
                <div className="feed__names">
                  {match.a.displayName} & {match.b.displayName}
                </div>
                <div className="small muted">
                  {texts.clockTime(
                    new Date(match.confirmedAt).toLocaleTimeString(texts.timeLocale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Photo({ url }: { url: string | null }): React.ReactElement {
  return url ? (
    <img className="thumb" src={resolveMediaUrl(url) ?? ''} alt="" />
  ) : (
    <div className="thumb" />
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
  busy,
  onRemove,
}: {
  participants: AdminParticipantRow[]
  busy: boolean
  onRemove: (participantId: string) => Promise<boolean>
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
            <th />
          </tr>
        </thead>
        <tbody>
          {participants.map((person) => (
            <tr key={person.id}>
              <td>
                <Photo url={person.photoUrl} />
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
              <td style={{ textAlign: 'right' }}>
                <RemoveParticipantButton busy={busy} onRemove={() => onRemove(person.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Für das Foto, das nicht auf die Leinwand gehört. Zweistufig, weil es endgültig
 * ist: Foto, Vorname und Profil sind weg, die Session gilt nicht mehr. Wer wieder
 * mitmachen will, muss den QR-Code neu scannen.
 */
function RemoveParticipantButton({
  busy,
  onRemove,
}: {
  busy: boolean
  onRemove: () => Promise<boolean>
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        className="btn btn--ghost btn--sm"
        disabled={busy}
        title="Foto, Vorname und Profil löschen und die Session beenden"
        onClick={() => setConfirming(true)}
      >
        Entfernen
      </button>
    )
  }

  return (
    <span className="row" style={{ justifyContent: 'flex-end' }}>
      <button
        className="btn btn--danger btn--sm"
        disabled={busy}
        onClick={() => {
          void onRemove().finally(() => setConfirming(false))
        }}
      >
        Wirklich entfernen?
      </button>
      <button className="btn btn--ghost btn--sm" onClick={() => setConfirming(false)}>
        Abbrechen
      </button>
    </span>
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
