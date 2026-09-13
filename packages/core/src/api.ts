/**
 * Typisierter HTTP-Client.
 *
 * Nutzt nur `fetch` und `FormData` — beides gibt es im Browser, in Node ≥18 und in
 * React Native. Das Zusammenbauen des Foto-Uploads bleibt bewusst beim Aufrufer,
 * weil sich `File` (Web) und `{ uri, name, type }` (React Native) dort unterscheiden.
 */

import type {
  AdminAccount,
  AdminMatchFeedItem,
  AdminParticipantRow,
  EventPublic,
  EventStats,
  EventSummary,
  FindMeConfig,
  Game,
  GameRunStats,
  GameState,
  GameType,
  MatchRecord,
  Participant,
  ParticipantProfile,
} from './types.js'
import type { Locale } from './i18n/locale.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  /** Liefert das Session-Token des Teilnehmers, falls vorhanden. */
  getSessionToken?: () => string | null
  /** Austauschbar für Tests und für Umgebungen mit eigenem fetch. */
  fetch?: typeof globalThis.fetch
}

/* ------------------------------------------------------------- Nutzlasten */

export interface JoinEventRequest {
  displayName: string
  profile?: ParticipantProfile
}

export interface JoinEventResponse {
  participant: Participant
  sessionToken: string
}

export interface MeResponse {
  participant: Participant
  event: EventSummary
  activeGame: Game | null
  matches: MatchRecord[]
}

export interface UpdateMeRequest {
  displayName?: string
  profile?: ParticipantProfile
  /**
   * Ergebnis der Kalibrierung im Onboarding. Wirkt nicht auf das Spiel — die
   * Schwelle wird auf dem Gerät angewendet. Der Server merkt sie sich, um nach
   * dem Event auswerten zu können, wie gut die Bump-Erkennung getragen hat.
   */
  bumpThreshold?: number
}

export interface UploadPhotoResponse {
  photoUrl: string
}

export interface AdminLoginRequest {
  email: string
  password: string
}

export interface CreateEventRequest {
  name: string
  startsAt?: string | null
  endsAt?: string | null
}

export interface UpdateEventRequest {
  name?: string
  archived?: boolean
  locale?: Locale
}

/** Ein Spiellauf samt seiner eigenen Kennzahlen. */
export interface AdminGameSummary extends Game {
  stats: GameRunStats
}

/**
 * Der Vorlauf vor einem Spielstart. Als Restzeit statt als Zeitpunkt: So kommt es
 * nicht darauf an, ob die Uhr des Rechners an der Leinwand richtig geht.
 */
export interface StartCountdown {
  remainingMs: number
}

export interface AdminEventDetail {
  event: EventSummary
  /** Vollständige URL, die im QR-Code steckt. */
  joinUrl: string
  games: AdminGameSummary[]
  activeGame: Game | null
  /** Gesetzt, solange der Vorlauf vor dem nächsten Spiel läuft. */
  startCountdown: StartCountdown | null
  participants: AdminParticipantRow[]
  stats: EventStats
  /** Die jüngsten bestätigten Begegnungen im Event, neueste zuerst. */
  recentMatches: AdminMatchFeedItem[]
}

export interface StartGameRequest {
  type: GameType
  config?: Partial<FindMeConfig>
}

export interface StartGameCountdownRequest extends StartGameRequest {
  /** Länge des Vorlaufs. Danach startet der Server das Spiel selbst. */
  seconds: number
}

export interface SetGameStateRequest {
  state: Extract<GameState, 'running' | 'paused' | 'ended'>
}

/* ---------------------------------------------------------------- Client */

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl.replace(/\/$/, '')

  async function request<T>(
    method: string,
    path: string,
    init: { json?: unknown; body?: BodyInit } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {}

    const token = options.getSessionToken?.()
    if (token) headers['Authorization'] = `Bearer ${token}`

    let body: BodyInit | undefined = init.body
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.json)
    }

    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body,
      // Die Admin-Session hängt an einem httpOnly-Cookie.
      credentials: 'include',
    })

    if (response.status === 204) return undefined as T

    const text = await response.text()
    const payload: unknown = text ? JSON.parse(text) : null

    if (!response.ok) {
      const err = (payload ?? {}) as { code?: string; message?: string }
      throw new ApiError(
        response.status,
        err.code ?? 'unknown',
        err.message ?? `Anfrage fehlgeschlagen (${response.status})`,
      )
    }

    return payload as T
  }

  return {
    /* --------------------------------------------------- Teilnehmer-Sicht */

    getEvent: (slug: string) =>
      request<EventPublic>('GET', `/api/events/${encodeURIComponent(slug)}`),

    joinEvent: (slug: string, body: JoinEventRequest) =>
      request<JoinEventResponse>('POST', `/api/events/${encodeURIComponent(slug)}/participants`, {
        json: body,
      }),

    getMe: () => request<MeResponse>('GET', '/api/participants/me'),

    updateMe: (body: UpdateMeRequest) =>
      request<Participant>('PATCH', '/api/participants/me', { json: body }),

    /** `form` muss das Feld `photo` enthalten. */
    uploadPhoto: (form: FormData) =>
      request<UploadPhotoResponse>('POST', '/api/participants/me/photo', { body: form }),

    /** Löscht Foto, Namen und Profil des eigenen Zugangs (DSGVO-Auskunftsrecht). */
    deleteMe: () => request<void>('DELETE', '/api/participants/me'),

    /* --------------------------------------------------------- Admin-Sicht */

    admin: {
      /**
       * Antwortet mit Token **und** setzt ein Cookie.
       *
       * Das Token ist der tragende Weg: Liegen Admin-App und API auf getrennten
       * Registrierungs-Domains — bei Railway ist jede Subdomain eine eigene —,
       * verwerfen Safari und Firefox das Cookie als Drittanbieter-Cookie.
       */
      login: (body: AdminLoginRequest) =>
        request<{ admin: AdminAccount; token: string }>('POST', '/api/admin/session', {
          json: body,
        }),

      logout: () => request<void>('DELETE', '/api/admin/session'),

      me: () => request<{ admin: AdminAccount }>('GET', '/api/admin/me'),

      listEvents: () => request<{ events: EventSummary[] }>('GET', '/api/admin/events'),

      createEvent: (body: CreateEventRequest) =>
        request<{ event: EventSummary }>('POST', '/api/admin/events', { json: body }),

      /** Name, Sprache oder Archivstatus ändern. Der Slug bleibt dabei immer gleich. */
      updateEvent: (eventId: string, body: UpdateEventRequest) =>
        request<{ event: EventSummary }>(
          'PATCH',
          `/api/admin/events/${encodeURIComponent(eventId)}`,
          {
            json: body,
          },
        ),

      getEvent: (eventId: string) =>
        request<AdminEventDetail>('GET', `/api/admin/events/${encodeURIComponent(eventId)}`),

      /** Startet ein Spiel. Der Server lehnt ab, wenn bereits eines läuft. */
      startGame: (eventId: string, body: StartGameRequest) =>
        request<{ game: Game }>('POST', `/api/admin/events/${encodeURIComponent(eventId)}/games`, {
          json: body,
        }),

      /**
       * Startet den Vorlauf vor einem Spiel. Nach Ablauf startet der Server das Spiel
       * selbst — der Tab, in dem der Admin geklickt hat, muss dafür nicht offen bleiben.
       */
      startGameCountdown: (eventId: string, body: StartGameCountdownRequest) =>
        request<{ startCountdown: StartCountdown }>(
          'POST',
          `/api/admin/events/${encodeURIComponent(eventId)}/countdown`,
          { json: body },
        ),

      cancelGameCountdown: (eventId: string) =>
        request<void>('DELETE', `/api/admin/events/${encodeURIComponent(eventId)}/countdown`),

      setGameState: (gameId: string, body: SetGameStateRequest) =>
        request<{ game: Game }>('POST', `/api/admin/games/${encodeURIComponent(gameId)}/state`, {
          json: body,
        }),
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
