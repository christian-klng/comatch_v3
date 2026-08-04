import {
  CONFIRMING_HOLD_MS,
  createBumpDetector,
  type ActivePair,
  type FindMeConfig,
} from '@comatch/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveMediaUrl } from '../api.js'
import { useGame } from '../game/GameProvider.js'
import { useMotionPermission, useMotionStream } from '../hooks/useMotion.js'
import { useWakeLock } from '../hooks/useWakeLock.js'
import { loadBumpThreshold } from '../session.js'

/**
 * Der Suchbildschirm: Foto des Partners, und das Gerät hört auf den Stoß.
 *
 * Hier hängt der Spielspaß an drei Kleinigkeiten, die man nicht sieht: Der
 * Bildschirm darf nicht sperren (sonst schweigt der Sensor), die Schwelle stammt aus
 * der Kalibrierung dieses Geräts, und der Zeitstempel des Stoßes wird in Serverzeit
 * umgerechnet, bevor er losgeschickt wird.
 */
export function SearchingView({
  pair,
  config,
}: {
  pair: ActivePair
  config: FindMeConfig
}): React.ReactElement {
  const { sendBump, sendManualConfirm, cancelPair, toServerTime, serverNow, ownSignalAt } =
    useGame()
  const { permission, request } = useMotionPermission()

  const threshold = useMemo(() => loadBumpThreshold() ?? undefined, [])
  const detectorRef = useRef(createBumpDetector(threshold ? { threshold } : {}))

  const [elapsed, setElapsed] = useState(0)
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, pair.expiresAt - serverNow()))

  // Der Wake Lock ist Voraussetzung, nicht Komfort: Bei gesperrtem Bildschirm
  // liefert devicemotion nichts mehr, und der Stoß bliebe unerkannt.
  useWakeLock(true)

  const sensorReady = permission === 'granted'
  const { receiving } = useMotionStream(sensorReady, (sample) => {
    const bump = detectorRef.current.push(sample)
    if (bump) sendBump(pair.id, toServerTime(bump.t), bump.magnitude)
  })

  // Ein neues Paar heißt neuer Filter — sonst schleppt der Tiefpass den Zustand
  // des letzten Stoßes mit in die nächste Runde.
  useEffect(() => {
    detectorRef.current.reset()
    setElapsed(0)
  }, [pair.id])

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((value) => value + 1_000)
      setTimeLeft(Math.max(0, pair.expiresAt - serverNow()))
    }, 1_000)
    return () => clearInterval(timer)
  }, [pair.expiresAt, serverNow])

  const confirming = ownSignalAt !== null && serverNow() - ownSignalAt < CONFIRMING_HOLD_MS

  /*
   * Die Rückfallebene erscheint früher, wenn klar ist, dass der Sensor nichts
   * liefert: Freigabe verweigert, gar nicht vorhanden — oder freigegeben, aber nach
   * ein paar Sekunden immer noch stumm (Notebook, Gerät ohne Beschleunigungssensor).
   * Sonst stünde man auf einem Event zwanzig Sekunden ohne jede Möglichkeit da,
   * den Match zu bestätigen.
   */
  const sensorIsSilent = !sensorReady || (elapsed >= 3_000 && !receiving)
  const showFallback =
    config.allowManualConfirm && (elapsed >= config.manualConfirmHintAfterMs || sensorIsSilent)

  const simulate = new URLSearchParams(location.search).get('simulateBump') === '1'

  return (
    <main className="screen">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">Finde diese Person</span>
        <span className="badge">
          <span className={receiving ? 'dot dot--live' : 'dot dot--warn'} />
          {receiving ? 'Sensor bereit' : 'Kein Sensor'}
        </span>
      </div>

      <div className={`hero-photo${confirming ? ' flash' : ''}`}>
        {pair.partner.photoUrl ? (
          <img src={resolveMediaUrl(pair.partner.photoUrl) ?? ''} alt={pair.partner.displayName} />
        ) : (
          <div className="screen screen--center">
            <p className="muted">Kein Foto</p>
          </div>
        )}
        <div className="hero-photo__name">{pair.partner.displayName}</div>
      </div>

      <div className="stack">
        {confirming ? (
          <p className="notice" style={{ textAlign: 'center' }}>
            Stoß erkannt — warte auf {pair.partner.displayName}…
          </p>
        ) : (
          <p className="muted" style={{ textAlign: 'center' }}>
            Gefunden? Haltet eure Handys aneinander und stoßt kurz an.
          </p>
        )}

        {permission === 'prompt' && (
          <button className="btn btn--ghost btn--block" onClick={() => void request()}>
            Bewegungssensor erlauben
          </button>
        )}

        {simulate && (
          <button
            className="btn btn--ghost btn--block"
            onClick={() => sendBump(pair.id, serverNow(), 25)}
          >
            Stoß simulieren (nur Entwicklung)
          </button>
        )}

        {showFallback && (
          <button
            className="btn btn--success btn--block"
            onClick={() => sendManualConfirm(pair.id)}
          >
            Wir haben uns gefunden
          </button>
        )}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn--quiet" onClick={() => cancelPair(pair.id)}>
            Ich finde die Person nicht
          </button>
          <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            noch {formatDuration(timeLeft)}
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
