import { randomUUID } from 'node:crypto'
import {
  CLIENT_EVENT,
  SERVER_EVENT,
  type ErrorAck,
  type EventChangedPayload,
  type EventPublic,
  type EventSummary,
  type HelloAck,
} from '@comatch/core'
import { eq, inArray } from 'drizzle-orm'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { admins, events, participants } from '../db/schema.js'
import { createSessionToken, hashPassword, hashToken } from '../lib/crypto.js'
import { startServer, type RunningServer } from '../server.js'

/**
 * Die Eventsprache: vom Admin gesetzt, öffentlich lesbar und live auf den Handys.
 *
 * Braucht ein laufendes Postgres: `npm run db:up && npm run db:migrate`.
 */

let server: RunningServer
let baseUrl: string
let token: string
const email = `test-${randomUUID().slice(0, 8)}@comatch.test`
const createdEventIds: string[] = []
const openSockets: Socket[] = []

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

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.disconnect()
})

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

/** Legt das Event über die Admin-Route an — nur so gilt der Vorgabewert wie im Betrieb. */
async function createEvent(): Promise<EventSummary> {
  const response = await call('POST', '/api/admin/events', { name: 'Sprach-Test' })
  expect(response.status).toBe(201)
  const { event } = (await response.json()) as { event: EventSummary }
  createdEventIds.push(event.id)
  return event
}

/** Ein Teilnehmer ohne Foto genügt: Die Begrüßung am Socket braucht nur die Session. */
async function connectParticipant(eventId: string): Promise<{ socket: Socket; ack: HelloAck }> {
  const sessionToken = createSessionToken()
  await db.insert(participants).values({
    eventId,
    displayName: 'Lea',
    sessionTokenHash: hashToken(sessionToken),
  })

  const socket = connectClient(baseUrl, { transports: ['websocket'], forceNew: true })
  openSockets.push(socket)

  const ack = (await socket.emitWithAck(CLIENT_EVENT.hello, { sessionToken })) as
    | HelloAck
    | ErrorAck
  if (!ack.ok) throw new Error(`Begrüßung abgelehnt: ${ack.code}`)
  return { socket, ack }
}

/* ------------------------------------------------------------------- Tests */

describe('Eventsprache', () => {
  it('startet auf Deutsch und ist nach dem Umstellen auch öffentlich sichtbar', async () => {
    const event = await createEvent()
    expect(event.locale).toBe('de')

    const updated = await call('PATCH', `/api/admin/events/${event.id}`, { locale: 'en' })
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { event: EventSummary }).event.locale).toBe('en')

    const publicView = await fetch(`${baseUrl}/api/events/${event.slug}`)
    expect(((await publicView.json()) as EventPublic).locale).toBe('en')
  })

  it('lehnt nicht unterstützte Sprachen ab', async () => {
    const event = await createEvent()

    const response = await call('PATCH', `/api/admin/events/${event.id}`, { locale: 'fr' })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe('invalid_payload')
  })

  it('kommt mit der Begrüßung und bei jedem Wechsel sofort auf die Handys', async () => {
    const event = await createEvent()
    const { socket, ack } = await connectParticipant(event.id)
    expect(ack.eventLocale).toBe('de')

    const received: EventChangedPayload[] = []
    socket.on(SERVER_EVENT.eventChanged, (payload: EventChangedPayload) => received.push(payload))

    await call('PATCH', `/api/admin/events/${event.id}`, { locale: 'en' })
    // Ein Umbenennen und ein unveränderter Wert dürfen keine Nachricht auslösen.
    await call('PATCH', `/api/admin/events/${event.id}`, { name: 'Neuer Name' })
    await call('PATCH', `/api/admin/events/${event.id}`, { locale: 'en' })
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(received).toEqual([{ locale: 'en' }])
  })
})
