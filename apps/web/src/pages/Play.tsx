import { DEFAULT_FIND_ME_CONFIG, errorMessage } from '@comatch/core'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { setSessionToken } from '../api.js'
import { MatchedView } from '../components/MatchedView.js'
import { PrivacyFooter } from '../components/PrivacyFooter.js'
import { SearchingView } from '../components/SearchingView.js'
import { GameProvider, useGame } from '../game/GameProvider.js'
import { useT } from '../i18n/I18nProvider.js'
import { clearSession, loadSession } from '../session.js'

export function Play(): React.ReactElement {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const session = loadSession(slug)

  useEffect(() => {
    if (session) setSessionToken(session.token)
  }, [session])

  if (!session) return <Navigate to={`/e/${slug}`} replace />

  return (
    <GameProvider
      sessionToken={session.token}
      onInvalidSession={() => {
        // Das Token gilt nicht mehr — etwa weil das Event bereinigt wurde.
        clearSession(slug)
        navigate(`/e/${slug}`, { replace: true })
      }}
    >
      <PlayScreen slug={slug} />
    </GameProvider>
  )
}

/**
 * Ein einziger Bildschirm mit mehreren Zuständen statt eigener Routen: Ein
 * Routenwechsel würde Socket und Wake Lock abreißen lassen — mitten in der Suche
 * wäre das genau der falsche Moment.
 */
function PlayScreen({ slug }: { slug: string }): React.ReactElement {
  const { status, errorCode, participant, game, pair, lastMatch, matches } = useGame()
  const t = useT()

  if (status === 'error') {
    return (
      <Centered title={t.play.errorTitle}>
        <p className="muted">{errorCode ? errorMessage(t, errorCode) : t.play.errorReload}</p>
      </Centered>
    )
  }

  if (status === 'connecting' || !participant) {
    return (
      <Centered title={t.play.connectingTitle}>
        <p className="muted">{t.play.connectingBody}</p>
      </Centered>
    )
  }

  // Ohne Foto gibt es nichts zu suchen — zurück ins Onboarding.
  if (!participant.photoUrl) return <Navigate to={`/e/${slug}/join`} replace />

  if (lastMatch) return <MatchedView match={lastMatch} />

  if (pair && game) return <SearchingView pair={pair} config={game.config} />

  if (!game || game.state === 'ended') {
    return (
      <Centered title={t.play.noGameTitle}>
        <p className="muted">{t.play.noGameBody}</p>
        <MatchCount count={matches.length} />
      </Centered>
    )
  }

  if (game.state === 'paused') {
    return (
      <Centered title={t.play.pausedTitle}>
        <p className="muted">{t.play.pausedBody}</p>
        <MatchCount count={matches.length} />
      </Centered>
    )
  }

  /*
   * `matched` ohne `lastMatch` heißt: Der Match liegt hinter uns und die Seite wurde
   * seither neu geladen oder das Handy war gesperrt. Serverseitig ist diese Person
   * **nicht** im Pool — der Matcher greift nur `waiting` auf. Ohne diesen Zweig
   * zeigte der Bildschirm „Gleich geht's los" und es käme nie wieder ein Partner.
   */
  if (participant.state === 'idle' || participant.state === 'matched') return <IdleView />

  return <WaitingView />
}

function WaitingView(): React.ReactElement {
  const { nextTickAt, serverNow, matches, game } = useGame()
  const t = useT()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const tickInterval = game?.config.tickIntervalMs ?? DEFAULT_FIND_ME_CONFIG.tickIntervalMs

  useEffect(() => {
    const update = () => {
      if (nextTickAt === null) {
        setSecondsLeft(null)
        return
      }

      /*
       * Bis zum nächsten Takt hochrollen, statt bei null stehenzubleiben.
       *
       * Der Server schickt nur dann einen neuen Zustand, wenn sich etwas ergibt.
       * Sind noch zu wenige Leute da, passiert beim Takt nichts — der Countdown
       * bliebe auf 0 stehen und sähe für den ersten Ankömmling kaputt aus. Der Takt
       * läuft aber gleichmäßig weiter, also lässt er sich hier fortschreiben.
       */
      const now = serverNow()
      let target = nextTickAt
      while (target <= now) target += tickInterval

      setSecondsLeft(Math.max(0, Math.ceil((target - now) / 1000)))
    }

    update()
    const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [nextTickAt, serverNow, tickInterval])

  return (
    <main className="screen" style={{ textAlign: 'center' }}>
      {/* Zwei Spacer halten den Inhalt mittig, der Fußbereich bleibt unten stehen. */}
      <div className="spacer" />

      <div className="stack" style={{ alignItems: 'center', alignSelf: 'center', maxWidth: 340 }}>
        <div className="radar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <h1>{t.play.waitingTitle}</h1>

        {secondsLeft !== null ? (
          <>
            <p className="countdown">{secondsLeft}</p>
            <p className="muted">{t.play.secondsUntilPairing(secondsLeft)}</p>
          </>
        ) : (
          <p className="muted">{t.play.pairingEvery(Math.round(tickInterval / 1000))}</p>
        )}

        <MatchCount count={matches.length} />
      </div>

      <div className="spacer" />
      <PrivacyFooter />
    </main>
  )
}

function IdleView(): React.ReactElement {
  const { joinQueue, matches } = useGame()
  const t = useT()

  return (
    <main className="screen" style={{ textAlign: 'center' }}>
      <div className="spacer" />

      <div className="stack" style={{ alignItems: 'center', alignSelf: 'center', maxWidth: 340 }}>
        <h1>{t.play.idleTitle}</h1>
        <p className="muted">{t.play.idleBody}</p>
        <MatchCount count={matches.length} />
        <button className="btn btn--block" onClick={joinQueue}>
          {t.play.rejoin}
        </button>
      </div>

      <div className="spacer" />
      <PrivacyFooter />
    </main>
  )
}

function MatchCount({ count }: { count: number }): React.ReactElement | null {
  const t = useT()
  if (count === 0) return null
  return <p className="badge">{t.play.matchCount(count)}</p>
}

function Centered({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <main className="screen screen--center">
      <div className="stack" style={{ alignItems: 'center', maxWidth: 340 }}>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  )
}
