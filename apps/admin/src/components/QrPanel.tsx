import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/**
 * Der QR-Code zum Event.
 *
 * Er wird meist projiziert oder ausgedruckt, deshalb die Vollbildansicht und die
 * hohe Auflösung: Ein hochskalierter kleiner Code wird auf einer Leinwand unscharf
 * und lässt sich aus den hinteren Reihen nicht mehr scannen. Fehlerkorrekturstufe M
 * verkraftet einen teilweise verdeckten Ausdruck.
 */
export function QrPanel({
  joinUrl,
  eventName,
}: {
  joinUrl: string
  eventName: string
}): React.ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)

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

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Ohne Zwischenablage-Berechtigung bleibt die URL darunter zum Abschreiben stehen.
    }
  }

  return (
    <>
      <div className="card stack">
        <p className="card__title">QR-Code</p>

        {dataUrl ? (
          <button
            className="qr"
            onClick={() => setFullscreen(true)}
            title="Vollbild zum Projizieren"
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
          <button className="btn btn--ghost" onClick={() => setFullscreen(true)}>
            Vollbild
          </button>
        </div>
      </div>

      {fullscreen && dataUrl && (
        <div
          className="qr-overlay"
          onClick={() => setFullscreen(false)}
          role="button"
          tabIndex={0}
          aria-label="Vollbild schließen"
        >
          <h1 style={{ color: '#0b0d13' }}>{eventName}</h1>
          <img src={dataUrl} alt={`QR-Code für ${eventName}`} />
          <p className="qr-overlay__url">{joinUrl}</p>
        </div>
      )}
    </>
  )
}
