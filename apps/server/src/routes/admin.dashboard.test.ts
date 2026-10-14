import { randomUUID } from 'node:crypto'
import { DEFAULT_FIND_ME_CONFIG, type AdminEventDetail } from '@comatch/core'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { admins, events, games, pairs, participants } from '../db/schema.js'
import { createSessionToken, hashPassword, hashToken } from '../lib/crypto.js'
import { startServer, type RunningServer } from '../server.js'

/**
 * Die Eventseite als Live-Dashboard: Countdown vor dem Spielstart und Match-Feed.
 *
 * Der Countdown lebt auf dem Server, damit ihn auch eine Eventseite sieht, in der
 * niemand geklickt hat — die auf der Leinwand. Deshalb wird er hier nur über
 * Abrufe der Eventseite beobachtet, nie über die Antwort des Starts.
 *
 * Braucht ein laufendes Postgres: `npm run db:up && npm run db:migrate`.
 */

let server: RunningServer
let baseUrl: string
let token: string
const email = `test-${randomUUID().slice(0, 8)}@comatch.test`
const createdEventIds: string[] = []

beforeAll(async () => {
  server = await startServer({ port: 0 })
  baseUrl = `http://localhost:${server.port}`

  const password = 'ein-test-passwort'
  await db.insert(admins).values({ email, passwordHash: await hashPassword(password) })
  const response = await fetch(`${baseUrl}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  token = ((await response.json()) as { token: string }).token
}, 30_000)

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await db.delete(events).where(inArray(events.id, createdEventIds))
  }
  await db.delete(admins).where(eq(admins.email, email))
  await server?.close()
  await closeDatabase()
}, 30_000)

/* ------------------------------------------------------------------ Helfer */

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function createEvent(): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({ slug: `test-${randomUUID().slice(0, 8)}`, name: 'Dashboard-Test' })
    .returning()
  createdEventIds.push(row!.id)
  return row!.id
}

async function getDetail(eventId: string): Promise<AdminEventDetail> {
  const response = await call('GET', `/api/admin/events/${eventId}`)
  expect(response.status).toBe(200)
  return (await response.json()) as AdminEventDetail
}

/** Fragt die Eventseite ab, bis `until` zutrifft — nach Ablauf kommt der letzte Stand zurück. */
async function waitForDetail(
  eventId: string,
  until: (detail: AdminEventDetail) => boolean,
  timeoutMs = 5_000,
): Promise<AdminEventDetail> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const detail = await getDetail(eventId)
    if (until(detail) || Date.now() > deadline) return detail
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const countdownPath = (eventId: string) => `/api/admin/events/${eventId}/countdown`
const statePath = (eventId: string) => `/api/admin/events/${eventId}/game/state`

/* ------------------------------------------------------------------- Tests */

describe('Countdown vor dem Spielstart', () => {
  it('ist auf der Eventseite sichtbar und startet das Spiel nach Ablauf selbst', async () => {
    const eventId = await createEvent()

    const started = await call('POST', countdownPath(eventId), { seconds: 1 })
    expect(started.status).toBe(201)

    const during = await getDetail(eventId)
    expect(during.game).toBeNull()
    expect(during.startCountdown?.remainingMs).toBeGreaterThan(0)
    expect(during.startCountdown?.remainingMs).toBeLessThanOrEqual(1_000)

    const after = await waitForDetail(
      eventId,
      (detail) => detail.game !== null && detail.startCountdown === null,
    )
    expect(after.game?.state).toBe('running')
    expect(after.startCountdown).toBeNull()
  })

  it('startet nach einem Abbruch kein Spiel', async () => {
    const eventId = await createEvent()

    await call('POST', countdownPath(eventId), { seconds: 1 })
    const cancelled = await call('DELETE', countdownPath(eventId))
    expect(cancelled.status).toBe(204)

    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const detail = await getDetail(eventId)
    expect(detail.startCountdown).toBeNull()
    expect(detail.game).toBeNull()
  })

  it('lässt keinen zweiten Countdown zu und weicht einem Sofortstart', async () => {
    const eventId = await createEvent()

    expect(
      (await call('POST', countdownPath(eventId), { seconds: 60 })).status,
    ).toBe(201)
    const second = await call('POST', countdownPath(eventId), { seconds: 60 })
    expect(second.status).toBe(409)

    const immediate = await call('POST', statePath(eventId), { state: 'running' })
    expect(immediate.status).toBe(200)
    expect((await getDetail(eventId)).startCountdown).toBeNull()

    const beside = await call('POST', countdownPath(eventId), { seconds: 60 })
    expect(beside.status).toBe(409)
    expect(((await beside.json()) as { code: string }).code).toBe('game_already_active')
  })
})

describe('Ein Spiel je Event', () => {
  it('pausiert und setzt dasselbe Spiel fort, statt ein neues anzulegen', async () => {
    const eventId = await createEvent()

    await call('POST', statePath(eventId), { state: 'running' })
    const first = (await getDetail(eventId)).game!
    expect(first.state).toBe('running')

    expect((await call('POST', statePath(eventId), { state: 'paused' })).status).toBe(200)
    expect((await getDetail(eventId)).game?.state).toBe('paused')

    // Ein zweiter Start vom anderen Gerät setzt fort, statt ein zweites Spiel zu öffnen.
    expect((await call('POST', statePath(eventId), { state: 'running' })).status).toBe(200)
    const resumed = (await getDetail(eventId)).game!
    expect(resumed.id).toBe(first.id)
    expect(resumed.state).toBe('running')
    expect(resumed.startedAt).toBe(first.startedAt)

    const rows = await db.select().from(games).where(eq(games.eventId, eventId))
    expect(rows).toHaveLength(1)
  })

  it('lässt sich nicht pausieren, bevor es lief', async () => {
    const eventId = await createEvent()

    const response = await call('POST', statePath(eventId), { state: 'paused' })
    expect(response.status).toBe(404)
    expect(((await response.json()) as { code: string }).code).toBe('game_not_found')
  })

  it('lässt sich erst nach dem Pausieren archivieren und danach nicht fortsetzen', async () => {
    const eventId = await createEvent()
    await call('POST', statePath(eventId), { state: 'running' })

    const blocked = await call('PATCH', `/api/admin/events/${eventId}`, { archived: true })
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { code: string }).code).toBe('event_has_active_game')

    await call('POST', statePath(eventId), { state: 'paused' })
    expect((await call('PATCH', `/api/admin/events/${eventId}`, { archived: true })).status).toBe(
      200,
    )

    const resume = await call('POST', statePath(eventId), { state: 'running' })
    expect(resume.status).toBe(409)
    expect(((await resume.json()) as { code: string }).code).toBe('event_archived')
  })
})

describe('Match-Feed', () => {
  it('zeigt bestätigte Begegnungen neueste zuerst und lässt gelöschte Zugänge weg', async () => {
    const eventId = await createEvent()
    const [game] = await db
      .insert(games)
      .values({ eventId, state: 'paused', config: DEFAULT_FIND_ME_CONFIG })
      .returning()

    const people = await db
      .insert(participants)
      .values(
        ['Anna', 'Ben', 'Cem', 'Dora'].map((displayName) => ({
          eventId,
          displayName,
          sessionTokenHash: hashToken(createSessionToken()),
          state: 'idle' as const,
        })),
      )
      .returning()
    const [anna, ben, cem, dora] = people.map((person) => person.id) as [
      string,
      string,
      string,
      string,
    ]

    const now = Date.now()
    const pair = (aId: string, bId: string, confirmedAgoMs: number | null) => ({
      gameId: game!.id,
      eventId,
      aId,
      bId,
      state: confirmedAgoMs === null ? ('pending' as const) : ('confirmed' as const),
      expiresAt: new Date(now + 60_000),
      confirmedAt: confirmedAgoMs === null ? null : new Date(now - confirmedAgoMs),
    })
    await db
      .insert(pairs)
      .values([
        pair(anna, ben, 60_000),
        pair(cem, anna, 10_000),
        pair(ben, cem, null),
        pair(dora, ben, 5_000),
      ])
    await db.update(participants).set({ deletedAt: new Date() }).where(eq(participants.id, dora))

    const detail = await getDetail(eventId)
    expect(detail.recentMatches.map((match) => [match.a.displayName, match.b.displayName])).toEqual(
      [
        ['Cem', 'Anna'],
        ['Anna', 'Ben'],
      ],
    )
  })
})
