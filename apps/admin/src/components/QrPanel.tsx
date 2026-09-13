import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { openProjection } from '../projection.js'

/**
 * Der QR-Code zum Event.
 *
 * Er wird meist projiziert oder ausgedruckt, deshalb die hohe Auflösung: Ein
 * hochskalierter kleiner Code wird auf einer Leinwand unscharf und lässt sich aus
 * den hinteren Reihen nicht mehr scannen. Fehlerkorrekturstufe M verkraftet einen
 * teilweise verdeckten Ausdruck. Ein Klick auf den Code öffnet die Projektion in
 * einem eigenen Fenster, damit das Dashboard währenddessen bedienbar bleibt.
 */
export function QrPanel({
  joinUrl,
  eventName,
  screen = false,
}: {
  joinUrl: string
  eventName: string
  /** Im Leinwand-Modus: nur Code und Adresse, kein Kopier-Knopf. */
  screen?: boolean
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

      <div className="join-url">
        <span className="mono muted">{joinUrl}</span>
        {!screen && (
          <button
            className={copied ? 'icon-btn icon-btn--done' : 'icon-btn'}
            onClick={() => void copy()}
            title={copied ? 'Kopiert' : 'Link kopieren'}
            aria-label={copied ? 'Kopiert' : 'Link kopieren'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
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

function CopyIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  )
}

function CheckIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}
