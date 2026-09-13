import type { Locale } from '@comatch/core'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { screenTexts, type ScreenTexts } from '../screenTexts.js'

/**
 * Der QR-Code zum Event.
 *
 * Er wird meist projiziert oder ausgedruckt, deshalb die hohe Auflösung: Ein
 * hochskalierter kleiner Code wird auf einer Leinwand unscharf und lässt sich aus
 * den hinteren Reihen nicht mehr scannen. Fehlerkorrekturstufe M verkraftet einen
 * teilweise verdeckten Ausdruck. Ein Klick auf den Code vergrößert ihn als Lightbox
 * über der Seite — kein eigenes Fenster, das der Popup-Blocker schlucken könnte
 * und das den Admin von der Steuerung wegholt.
 */
export function QrPanel({
  joinUrl,
  eventName,
  locale,
  screen = false,
}: {
  joinUrl: string
  eventName: string
  /** Sprache des Events — für die Leinwand. */
  locale: Locale
  /** Im Leinwand-Modus: nur Code und Adresse, kein Kopier-Knopf. */
  screen?: boolean
}): React.ReactElement {
  const texts = screenTexts(locale, screen)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [enlarged, setEnlarged] = useState(false)

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

  return (
    <div className="card stack">
      <p className="card__title">{texts.qr.title}</p>

      {dataUrl ? (
        <button
          className="qr"
          onClick={() => setEnlarged(true)}
          title={texts.qr.enlarge}
          style={{ border: 'none', cursor: 'zoom-in', padding: 12 }}
        >
          <img src={dataUrl} alt={texts.qr.alt(eventName)} />
        </button>
      ) : (
        <p className="muted">{texts.qr.generating}</p>
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

      {enlarged && dataUrl && (
        <QrLightbox
          dataUrl={dataUrl}
          joinUrl={joinUrl}
          eventName={eventName}
          texts={texts}
          onClose={() => setEnlarged(false)}
        />
      )}
    </div>
  )
}

/** Der Code groß über der Seite. Esc, ein Klick daneben oder der Knopf schließen. */
function QrLightbox({
  dataUrl,
  joinUrl,
  eventName,
  texts,
  onClose,
}: {
  dataUrl: string
  joinUrl: string
  eventName: string
  texts: ScreenTexts
  onClose: () => void
}): React.ReactElement {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()

    /*
     * In der Capture-Phase, damit Esc hier endet: Die Eventseite hört auf Window-Ebene
     * ebenfalls auf Esc und würde sonst gleich mit den Leinwand-Modus beenden.
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={texts.qr.alt(eventName)}
      onClick={onClose}
    >
      <button
        ref={closeButton}
        className="btn btn--ghost lightbox__close"
        onClick={onClose}
        title={`${texts.qr.close} (Esc)`}
      >
        {texts.qr.close}
      </button>
      {/* Klicks auf den Code selbst sollen ihn nicht schließen — man will ihn ja ansehen. */}
      <div className="lightbox__qr" onClick={(event) => event.stopPropagation()}>
        <img src={dataUrl} alt={texts.qr.alt(eventName)} />
      </div>
      <p className="lightbox__name">{eventName}</p>
      <p className="lightbox__url mono">{joinUrl}</p>
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
