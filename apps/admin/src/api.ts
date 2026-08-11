import { createApiClient } from '@comatch/core'

export const API_URL: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:4000` : location.origin)

/**
 * Die Admin-Anmeldung hängt an einem Token, nicht am Cookie.
 *
 * Ein httpOnly-Cookie wäre die sicherere Bauart, funktioniert hier aber nicht:
 * Admin-App und API liegen auf getrennten Registrierungs-Domains (bei Railway ist
 * jede `*.up.railway.app`-Subdomain eine eigene). Der Browser behandelt das Cookie
 * dann als Drittanbieter-Cookie und verwirft es — in Safari und Firefox
 * grundsätzlich. Die Anmeldung gelänge, der nächste Abruf nicht.
 *
 * Abgelegt in `sessionStorage` statt `localStorage`: Auf einem geliehenen Laptop
 * am Eventrand endet die Anmeldung damit mit dem Schließen des Browsers.
 */
const TOKEN_KEY = 'comatch.admin.token'

export function loadAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveAdminToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Ohne Speicher gilt die Anmeldung nur bis zum nächsten Neuladen.
  }
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nichts zu tun.
  }
}

export const api = createApiClient({
  baseUrl: API_URL,
  getSessionToken: loadAdminToken,
})

/** Fotos kommen im lokalen Speichermodus als relative /media-URL vom API-Server. */
export function resolveMediaUrl(url: string | null): string | null {
  if (!url) return null
  return url.startsWith('/') ? `${API_URL}${url}` : url
}
