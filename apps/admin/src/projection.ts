import type { Locale } from '@comatch/core'
import QRCode from 'qrcode'
import { SCREEN_TEXTS } from './screenTexts.js'

/**
 * Das Projektionsfenster: ein eigenes Browserfenster mit dem QR-Code, weiß auf
 * schwarz. Ein eigenes Fenster statt eines Overlays, damit das Dashboard während
 * der Projektion bedienbar bleibt — der Admin steuert die Spiele ja live weiter.
 *
 * Als Modul-Singleton statt Komponenten-State: Ein zweiter Klick holt das offene
 * Fenster nach vorn, statt ein weiteres zu öffnen — auch wenn das QR-Panel
 * inzwischen neu eingehängt wurde.
 *
 * Einen Countdown zeigt es bewusst nicht mehr: Als Vollbild-Einblendung verdeckte er
 * genau den QR-Code, den das Fenster zeigen soll. Die Leinwand ist dafür jetzt die
 * Eventseite selbst.
 *
 * Es spricht die Sprache des Events, nicht die der Steuerung — gelesen wird es vom Saal.
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
export async function openProjection(
  joinUrl: string,
  eventName: string,
  locale: Locale,
): Promise<boolean> {
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
  const texts = SCREEN_TEXTS[locale]

  win.document.write(`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(texts.qr.windowTitle(eventName))}</title>
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
</style>
</head>
<body>
<h1>${escapeHtml(eventName)}</h1>
<img src="${dataUrl}" alt="${escapeHtml(texts.qr.title)}">
<p class="url">${escapeHtml(joinUrl)}</p>
</body>
</html>`)
  win.document.close()
  return true
}
