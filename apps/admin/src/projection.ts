import QRCode from 'qrcode'

/**
 * Das Projektionsfenster: ein eigenes Browserfenster mit dem QR-Code, weiß auf
 * schwarz. Ein eigenes Fenster statt eines Overlays, damit das Dashboard während
 * der Projektion bedienbar bleibt — der Admin steuert die Spiele ja live weiter.
 *
 * Als Modul-Singleton statt Komponenten-State, weil zwei Stellen darauf zugreifen:
 * das QR-Panel öffnet es, die Spielsteuerung schreibt den Start-Countdown hinein.
 * Das geht direkt per DOM-Zugriff — ein per `window.open('')` geöffnetes Fenster
 * ist same-origin mit dem Öffner.
 */

let win: Window | null = null

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Öffnet das Fenster (oder holt es nach vorn). `false` bei Popup-Blocker. */
export async function openProjection(joinUrl: string, eventName: string): Promise<boolean> {
  if (win && !win.closed) {
    win.focus()
    return true
  }

  // Synchron im Klick öffnen: Nach einem `await` gilt die User-Geste in strengen
  // Browsern nicht mehr, und der Popup-Blocker schlüge zu.
  win = window.open('', '_blank')
  if (!win) return false

  /*
   * Invertiert zur Panel-Vorschau: Auf einem Beamer strahlt eine große weiße
   * Fläche den ganzen Saal an — schwarz mit weißem Code ist angenehmer und
   * genauso scanbar.
   */
  const dataUrl = await QRCode.toDataURL(joinUrl, {
    width: 1024,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#ffffff', light: '#000000' },
  })

  win.document.write(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escapeHtml(eventName)} — QR-Code</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #000; color: #fff; font-family: system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 28px; text-align: center;
  }
  h1 { margin: 0; font-size: clamp(24px, 4vmin, 48px); font-weight: 600; }
  img { width: min(72vmin, 900px); image-rendering: pixelated; }
  .url { margin: 0; font-family: ui-monospace, monospace; font-size: clamp(14px, 2.2vmin, 26px); opacity: 0.65; }
  #countdown {
    display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.88);
    flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  }
  #countdown .label { font-size: clamp(20px, 3.5vmin, 44px); }
  #countdown .seconds { font-size: clamp(80px, 24vmin, 320px); font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1>${escapeHtml(eventName)}</h1>
<img src="${dataUrl}" alt="QR-Code">
<p class="url">${escapeHtml(joinUrl)}</p>
<div id="countdown"><div class="label">Neues Spiel startet in</div><div class="seconds"></div></div>
</body>
</html>`)
  win.document.close()
  return true
}

/**
 * Countdown im Projektionsfenster anzeigen bzw. mit `null` ausblenden.
 * Ohne offenes Fenster passiert nichts — der Countdown im Dashboard reicht dann.
 */
export function showProjectionCountdown(secondsLeft: number | null): void {
  if (!win || win.closed) return
  const overlay = win.document.getElementById('countdown')
  if (!overlay) return

  if (secondsLeft === null) {
    overlay.style.display = 'none'
    return
  }
  const seconds = overlay.querySelector('.seconds')
  if (seconds) seconds.textContent = String(secondsLeft)
  overlay.style.display = 'flex'
}
