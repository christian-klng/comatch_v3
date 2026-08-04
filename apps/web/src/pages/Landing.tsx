/**
 * Die Startseite.
 *
 * Bewusst leer bis auf einen Satz: Ohne QR-Code eines Events gibt es hier nichts zu
 * tun. Keine Anmeldung, keine Eventliste, kein Menü — jede weitere Option wäre eine
 * Ablenkung von dem einen Schritt, der zählt.
 */
export function Landing(): React.ReactElement {
  return (
    <main className="screen screen--center">
      <div className="stack" style={{ alignItems: 'center', maxWidth: 320 }}>
        <QrIcon />
        <h1>Scan the QR Code</h1>
        <p className="muted">
          Dein Gastgeber zeigt einen QR-Code. Scanne ihn mit der Kamera, um beim Event
          mitzumachen.
        </p>
      </div>
    </main>
  )
}

function QrIcon(): React.ReactElement {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: 'var(--accent)' }}
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM19 19h2M14 21h3M21 14v3" />
    </svg>
  )
}
