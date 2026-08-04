import { createApiClient } from '@comatch/core'

/**
 * In der Entwicklung läuft die API auf einem eigenen Port, in Produktion hinter
 * derselben Domain. `VITE_API_URL` überschreibt beides.
 */
export const API_URL: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:4000` : location.origin)

/** Wird beim Wechsel des Events gesetzt, damit der Client das richtige Token schickt. */
let sessionToken: string | null = null

export function setSessionToken(token: string | null): void {
  sessionToken = token
}

export const api = createApiClient({
  baseUrl: API_URL,
  getSessionToken: () => sessionToken,
})

/**
 * Bilder liegen im lokalen Speichermodus hinter einer relativen `/media`-URL. Die
 * kommt vom API-Server, nicht vom Vite-Server — deshalb hier absolut machen.
 */
export function resolveMediaUrl(url: string | null): string | null {
  if (!url) return null
  return url.startsWith('/') ? `${API_URL}${url}` : url
}
