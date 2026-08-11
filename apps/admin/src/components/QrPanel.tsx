import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { openProjection } from '../projection.js'

/**
 * Der QR-Code zum Event.
 *
 * Er wird meist projiziert oder ausgedruckt, deshalb die hohe Auflösung: Ein
 * hochskalierter kleiner Code wird auf einer Leinwand unscharf und lässt sich aus
 * den hinteren Reihen nicht mehr scannen. Fehlerkorrekturstufe M verkraftet einen
 * teilweise verdeckten Ausdruck. Die Projektion öffnet ein eigenes Fenster, damit
 * das Dashboard währenddessen bedienbar bleibt.
 */
export function QrPanel({
  joinUrl,
  eventName,
}: {
  joinUrl: string
  eventName: string
}): React.ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let cancelled = false

    QRCode.toDataURL(joinUrl, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0d13', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [joinUrl])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Ohne Zwischenablage-Berechtigung bleibt die URL darunter zum Abschreiben stehen.
    }
  }

  async function project(): Promise<void> {
    const opened = await openProjection(joinUrl, eventName)
    setBlocked(!opened)
  }

  return (
    <div className="card stack">
      <p className="card__title">QR-Code</p>

      {dataUrl ? (
        <button
          className="qr"
          onClick={() => void project()}
          title="Öffnet ein eigenes Fenster zum Projizieren — das Dashboard bleibt bedienbar."
          style={{ border: 'none', cursor: 'zoom-in', padding: 12 }}
        >
          <img src={dataUrl} alt={`QR-Code für ${eventName}`} />
        </button>
      ) : (
        <p className="muted">Wird erzeugt…</p>
      )}

      <p className="mono muted" style={{ wordBreak: 'break-all' }}>
        {joinUrl}
      </p>

      <div className="row">
        <button className="btn btn--ghost" onClick={() => void copy()}>
          {copied ? 'Kopiert' : 'Link kopieren'}
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => void project()}
          title="Öffnet ein eigenes Fenster zum Projizieren — das Dashboard bleibt bedienbar."
        >
          Projektion öffnen
        </button>
      </div>

      {blocked && (
        <p className="notice notice--error">
          Der Browser hat das Fenster blockiert. Erlaube Pop-ups für diese Seite und versuche es
          erneut.
        </p>
      )}
    </div>
  )
}
