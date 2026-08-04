import { createApiClient } from '@comatch/core'

export const API_URL: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:4000` : location.origin)

/*
 * Kein Session-Token: Die Admin-Session hängt an einem signierten httpOnly-Cookie.
 * Die Admin-App läuft im Eventbetrieb auf einem fremden Laptop oder am Beamer —
 * dort wäre ein Token im localStorage per XSS greifbar, ein httpOnly-Cookie nicht.
 */
export const api = createApiClient({ baseUrl: API_URL })

/** Fotos kommen im lokalen Speichermodus als relative /media-URL vom API-Server. */
export function resolveMediaUrl(url: string | null): string | null {
  if (!url) return null
  return url.startsWith('/') ? `${API_URL}${url}` : url
}
