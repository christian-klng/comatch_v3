import { calibrateThreshold, createBumpDetector } from '@comatch/core'
import { useRef, useState } from 'react'
import { useMotionPermission, useMotionStream } from '../hooks/useMotion.js'
import { useT } from '../i18n/I18nProvider.js'
import { saveBumpThreshold } from '../session.js'

/** So viele Probe-Stöße werden gesammelt, bevor die Schwelle steht. */
const SAMPLES_NEEDED = 3

/**
 * Während der Kalibrierung wird bewusst niedrig ausgelöst: Hier soll auch ein
 * zaghafter Probe-Stoß erfasst werden, damit die daraus berechnete Schwelle zum
 * tatsächlichen Verhalten dieser Person und dieses Geräts passt.
 */
const CALIBRATION_THRESHOLD = 6

/**
 * Kalibrierung der Bump-Erkennung.
 *
 * Der wichtigste Schritt für die Trefferquote im Spiel: Die Sensorempfindlichkeit
 * unterscheidet sich zwischen Geräten um ein Vielfaches, und wie fest jemand die
 * Handys aneinanderstößt, ebenso. Eine feste Schwelle wäre auf dem einen Gerät taub
 * und auf dem anderen so empfindlich, dass schon Gehen einen Match auslöst.
 */
export function CalibrationStep({
  onDone,
}: {
  onDone: (threshold: number | null) => void
}): React.ReactElement {
  const t = useT()
  const { permission, request } = useMotionPermission()
  const [peaks, setPeaks] = useState<number[]>([])
  const detectorRef = useRef(createBumpDetector({ threshold: CALIBRATION_THRESHOLD }))

  const collecting = permission === 'granted' && peaks.length < SAMPLES_NEEDED

  useMotionStream(collecting, (sample) => {
    const bump = detectorRef.current.push(sample)
    if (!bump) return

    setPeaks((current) => {
      if (current.length >= SAMPLES_NEEDED) return current
      const next = [...current, bump.magnitude]
      if (next.length === SAMPLES_NEEDED) {
        const threshold = calibrateThreshold(next)
        saveBumpThreshold(threshold)
        onDone(threshold)
      }
      return next
    })
  })

  if (permission === 'unsupported') {
    return (
      <div className="stack">
        <h2>{t.calibration.unsupportedTitle}</h2>
        <p className="muted">{t.calibration.unsupportedBody}</p>
        <button className="btn btn--block" onClick={() => onDone(null)}>
          {t.common.continue}
        </button>
      </div>
    )
  }

  if (permission === 'denied') {
    return (
      <div className="stack">
        <h2>{t.calibration.deniedTitle}</h2>
        <p className="muted">{t.calibration.deniedBody}</p>
        <button className="btn btn--block" onClick={() => onDone(null)}>
          {t.calibration.continueWithout}
        </button>
      </div>
    )
  }

  if (permission === 'prompt') {
    return (
      <div className="stack">
        <h2>{t.calibration.promptTitle}</h2>
        <p className="muted">{t.calibration.promptBody}</p>
        {/*
          iOS verlangt die Abfrage aus einer echten Nutzergeste heraus. Deshalb hängt sie
          an diesem Knopf und nicht am Seitenaufbau — sonst lehnt Safari ohne Rückfrage ab.
        */}
        <button className="btn btn--block" onClick={() => void request()}>
          {t.calibration.allow}
        </button>
        <button className="btn btn--quiet" onClick={() => onDone(null)}>
          {t.common.skip}
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      <h2>{t.calibration.tapTitle}</h2>
      <p className="muted">{t.calibration.tapBody(SAMPLES_NEEDED)}</p>

      <div className="row" style={{ justifyContent: 'center', gap: 16, padding: '24px 0' }}>
        {Array.from({ length: SAMPLES_NEEDED }, (_, index) => (
          <span
            key={index}
            className={index < peaks.length ? 'flash' : undefined}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: '2px solid var(--border)',
              background: index < peaks.length ? 'var(--success)' : 'transparent',
              transition: 'background 0.2s ease',
            }}
          />
        ))}
      </div>

      <p className="small muted" style={{ textAlign: 'center' }}>
        {t.calibration.progress(peaks.length, SAMPLES_NEEDED)}
      </p>

      <button className="btn btn--quiet" onClick={() => onDone(null)}>
        {t.common.skip}
      </button>
    </div>
  )
}
