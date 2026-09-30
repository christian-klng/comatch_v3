import type { ActivePair } from '@comatch/core'
import { useEffect, useState } from 'react'
import { resolveMediaUrl } from '../api.js'
import { useGame } from '../game/GameProvider.js'
import { useWakeLock } from '../hooks/useWakeLock.js'
import { useT } from '../i18n/I18nProvider.js'

const PENDING_TIMEOUT_MS = 5_000

/**
 * Der Suchbildschirm: Foto des Partners, und sobald man sich gefunden hat, die
 * Bestätigung per Code.
 *
 * Wer „Wir haben uns gefunden“ tippt, zeigt seinen Code; das Gegenüber wählt ihn aus
 * drei Vorschlägen. Welche Seite was sieht, entscheidet allein der Server — tippen
 * beide gleichzeitig, bekommt trotzdem nur einer den Code.
 */
export function SearchingView({ pair }: { pair: ActivePair }): React.ReactElement {
  const { requestConfirm, chooseCode, cancelPair, serverNow } = useGame()
  const t = useT()

  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, pair.expiresAt - serverNow()))
  // Nach dem Tipp bis zur Antwort des Servers gesperrt — ein Doppeltipp wäre sonst ein zweiter Versuch.
  const [pending, setPending] = useState(false)

  // Sperrt der Bildschirm, schläft die Verbindung ein — nach 20 s ohne Heartbeat löst
  // der Server das Paar auf. Und wer mit dem Foto durch den Raum läuft, tippt nichts an.
  useWakeLock(true)

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(Math.max(0, pair.expiresAt - serverNow())), 1_000)
    return () => clearInterval(timer)
  }, [pair.expiresAt, serverNow])

  // Jede Antwort des Servers bringt einen neuen Stand des Paares und gibt die Knöpfe frei.
  useEffect(() => setPending(false), [pair])

  // Bleibt die Antwort aus (gedrosselt, Verbindung weg), soll niemand vor grauen Knöpfen stehen.
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pending])

  const { confirmation } = pair
  const name = pair.partner.displayName

  return (
    <main className="screen">
      <span className="eyebrow">{t.findMe.findPerson}</span>

      <div className="hero-photo">
        {pair.partner.photoUrl ? (
          <img src={resolveMediaUrl(pair.partner.photoUrl) ?? ''} alt={name} />
        ) : (
          <div className="screen screen--center">
            <p className="muted">{t.findMe.noPhoto}</p>
          </div>
        )}
        <div className="hero-photo__name">{name}</div>
      </div>

      <div className="stack">
        {confirmation?.role === 'show' && (
          <div className="confirm-code">
            <span className="eyebrow">{t.findMe.showCodeTitle}</span>
            <p className="confirm-code__value">{confirmation.code}</p>
            <p className="small muted">{t.findMe.showCodeBody(name)}</p>
          </div>
        )}

        {confirmation?.role === 'choose' && (
          <>
            <div className="stack" style={{ gap: 4, textAlign: 'center' }}>
              <h2>{t.findMe.chooseCodeTitle(name)}</h2>
              <p className="small muted">{t.findMe.chooseCodeHint}</p>
            </div>
            {confirmation.choices.map((code) => (
              <button
                key={code}
                className="btn btn--ghost btn--block code-choice"
                disabled={pending}
                onClick={() => {
                  setPending(true)
                  chooseCode(pair.id, code)
                }}
              >
                {code}
              </button>
            ))}
          </>
        )}

        {!confirmation && (
          <>
            {pair.codeMisses > 0 ? (
              <p className="notice" style={{ textAlign: 'center' }}>
                {t.findMe.codeMissed}
              </p>
            ) : (
              <p className="muted" style={{ textAlign: 'center' }}>
                {t.findMe.instruction}
              </p>
            )}
            <button
              className="btn btn--success btn--block"
              disabled={pending}
              onClick={() => {
                setPending(true)
                requestConfirm(pair.id)
              }}
            >
              {t.findMe.confirm}
            </button>
          </>
        )}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn--quiet" onClick={() => cancelPair(pair.id)}>
            {t.findMe.cantFind}
          </button>
          <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t.findMe.timeLeft(formatDuration(timeLeft))}
          </span>
        </div>
      </div>
    </main>
  )
}

function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
