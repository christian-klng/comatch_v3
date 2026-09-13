import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { admins, events, games, participants } from '../db/schema.js'
import { createSessionToken, hashPassword, hashToken } from '../lib/crypto.js'
import { startServer, type RunningServer } from '../server.js'

/**
 * Was der Admin gegen Personendaten in der Hand hat: einzelne Teilnehmer entfernen
 * und ein ganzes Event sofort bereinigen. Beides ist endgültig — hier wird geprüft,
 * dass danach wirklich nichts mehr geht, aber auch nichts kaputt ist.
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

function asAdmin(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function asParticipant(sessionToken: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${sessionToken}` } })
}

async function createEvent(): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({ slug: `mod-${randomUUID().slice(0, 8)}`, name: 'Moderations-Test' })
    .returning()
  createdEventIds.push(row!.id)
  return row!.id
}

async function addParticipant(eventId: string, displayName: string) {
  const sessionToken = createSessionToken()
  const [row] = await db
    .insert(participants)
    .values({
      eventId,
      displayName,
      photoKey: `test/${randomUUID()}.webp`,
      profile: { company: 'Beispiel GmbH' },
      sessionTokenHash: hashToken(sessionToken),
      state: 'waiting',
    })
    .returning()
  return { id: row!.id, sessionToken }
}

describe('Teilnehmer entfernen', () => {
  it('löscht Personendaten und macht die Session ungültig', async () => {
    const eventId = await createEvent()
    const anna = await addParticipant(eventId, 'Anna')

    expect((await asParticipant(anna.sessionToken, '/api/participants/me')).status).toBe(200)

    const response = await asAdmin('DELETE', `/api/admin/participants/${anna.id}`)
    expect(response.status).toBe(204)

    const [row] = await db.select().from(participants).where(eq(participants.id, anna.id))
    expect(row?.displayName).toBe('Entfernt')
    expect(row?.photoKey).toBeNull()
    expect(row?.profile).toEqual({})
    expect(row?.deletedAt).not.toBeNull()

    expect((await asParticipant(anna.sessionToken, '/api/participants/me')).status).toBe(401)
  }, 30_000)

  it('verschwindet aus der Teilnehmerliste des Events', async () => {
    const eventId = await createEvent()
    const anna = await addParticipant(eventId, 'Anna')
    await addParticipant(eventId, 'Ben')

    await asAdmin('DELETE', `/api/admin/participants/${anna.id}`)

    const detail = (await (await asAdmin('GET', `/api/admin/events/${eventId}`)).json()) as {
      participants: Array<{ displayName: string }>
    }
    expect(detail.participants.map((row) => row.displayName)).toEqual(['Ben'])
  }, 30_000)

  it('ist beim zweiten Mal kein Fehler', async () => {
    const eventId = await createEvent()
    const anna = await addParticipant(eventId, 'Anna')

    await asAdmin('DELETE', `/api/admin/participants/${anna.id}`)
    expect((await asAdmin('DELETE', `/api/admin/participants/${anna.id}`)).status).toBe(204)
  }, 30_000)

  it('meldet Unbekannte als 404 und verlangt eine Anmeldung', async () => {
    expect((await asAdmin('DELETE', `/api/admin/participants/${randomUUID()}`)).status).toBe(404)
    const anonymous = await fetch(`${baseUrl}/api/admin/participants/${randomUUID()}`, {
      method: 'DELETE',
    })
    expect(anonymous.status).toBe(401)
  }, 30_000)
})

describe('Event sofort bereinigen', () => {
  it('löscht alle Personendaten und archiviert das Event', async () => {
    const eventId = await createEvent()
    const anna = await addParticipant(eventId, 'Anna')
    const ben = await addParticipant(eventId, 'Ben')

    const response = await asAdmin('POST', `/api/admin/events/${eventId}/purge`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      event: { archivedAt: string | null; purgedAt: string | null }
      photos: number
    }
    expect(body.photos).toBe(2)
    expect(body.event.archivedAt).not.toBeNull()
    expect(body.event.purgedAt).not.toBeNull()

    const rows = await db
      .select()
      .from(participants)
      .where(inArray(participants.id, [anna.id, ben.id]))
    expect(rows.every((row) => row.photoKey === null && row.deletedAt !== null)).toBe(true)

    expect((await asParticipant(anna.sessionToken, '/api/participants/me')).status).toBe(401)
  }, 30_000)

  it('lehnt ab, solange ein Spiel läuft', async () => {
    const eventId = await createEvent()
    const anna = await addParticipant(eventId, 'Anna')
    await db.insert(games).values({
      eventId,
      type: 'find_me',
      state: 'paused',
      config: {
        tickIntervalMs: 10_000,
        pairTimeoutMs: 180_000,
        bumpWindowMs: 1_200,
        minBumpMagnitude: 8,
        allowManualConfirm: true,
        manualConfirmWindowMs: 10_000,
        manualConfirmHintAfterMs: 20_000,
      },
    })

    const response = await asAdmin('POST', `/api/admin/events/${eventId}/purge`)
    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe('event_has_active_game')

    const [row] = await db.select().from(participants).where(eq(participants.id, anna.id))
    expect(row?.photoKey).not.toBeNull()
  }, 30_000)

  it('nimmt ein Enddatum über PATCH an', async () => {
    const eventId = await createEvent()
    const endsAt = new Date('2030-05-01T21:59:59.999Z').toISOString()

    const response = await asAdmin('PATCH', `/api/admin/events/${eventId}`, { endsAt })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { event: { endsAt: string } }).event.endsAt).toBe(endsAt)

    const cleared = await asAdmin('PATCH', `/api/admin/events/${eventId}`, { endsAt: null })
    expect(((await cleared.json()) as { event: { endsAt: null } }).event.endsAt).toBeNull()
  }, 30_000)
})
