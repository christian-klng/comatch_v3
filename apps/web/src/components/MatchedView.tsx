import type { MatchConfirmedPayload } from '@comatch/core'
import { resolveMediaUrl } from '../api.js'
import { useGame } from '../game/GameProvider.js'
import { useT } from '../i18n/I18nProvider.js'

/**
 * Der Moment nach dem Stoß.
 *
 * Erst hier wird das Profil sichtbar — vorher wäre es ein Hinweis gewesen, der die
 * Suche entwertet. Und erst hier gibt es überhaupt etwas zu lesen: Während der Suche
 * schaut man in den Raum, nicht auf den Bildschirm.
 */
export function MatchedView({ match }: { match: MatchConfirmedPayload }): React.ReactElement {
  const { joinQueue, leaveQueue } = useGame()
  const t = useT()
  const { partner } = match
  const hasProfile = Boolean(partner.profile.company || partner.profile.role)

  return (
    <main className="screen">
      <div className="stack" style={{ textAlign: 'center' }}>
        <p className="eyebrow">{t.findMe.matchNumber(match.totalMatches)}</p>
        <h1>{t.findMe.matchedTitle}</h1>
      </div>

      <div className="spacer" />

      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        {partner.photoUrl && (
          <img
            className="avatar"
            style={{ width: 140, height: 140, borderRadius: '50%' }}
            src={resolveMediaUrl(partner.photoUrl) ?? ''}
            alt={partner.displayName}
          />
        )}
        <h2>{partner.displayName}</h2>

        {hasProfile && (
          <p className="muted">
            {[partner.profile.role, partner.profile.company].filter(Boolean).join(' · ')}
          </p>
        )}

        {partner.profile.linkedin && (
          <a
            className="btn btn--quiet"
            href={partner.profile.linkedin}
            target="_blank"
            rel="noreferrer noopener"
          >
            LinkedIn
          </a>
        )}
      </div>

      <div className="spacer" />

      <div className="stack">
        {/*
          „Erstmal unterhalten" steht zuerst und ist der ruhigere Knopf: Das Gespräch
          ist der Zweck des Spiels, nicht der nächste Match.
        */}
        <button className="btn btn--block" onClick={leaveQueue}>
          {t.findMe.keepTalking}
        </button>
        <button className="btn btn--ghost btn--block" onClick={joinQueue}>
          {t.findMe.keepSearching}
        </button>
      </div>
    </main>
  )
}
