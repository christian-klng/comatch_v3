import { randomUUID } from 'node:crypto'
import { type AdminEventDetail, type EventSummary, type ExplainerStep } from '@comatch/core'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { admins, events, explainerSteps } from '../db/schema.js'
import { hashPassword } from '../lib/crypto.js'
import { photoStorage } from '../lib/storage.js'
import { startServer, type RunningServer } from '../server.js'

/**
 * Die Spielerklärung für die Leinwand: drei Schritte aus Titel, Bild und Text.
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
    const rows = await db
      .select({ imageKey: explainerSteps.imageKey })
      .from(explainerSteps)
      .where(inArray(explainerSteps.eventId, createdEventIds))
    await photoStorage.remove(rows.flatMap((row) => (row.imageKey ? [row.imageKey] : [])))
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

async function createEvent(): Promise<EventSummary> {
  const response = await call('POST', '/api/admin/events', { name: 'Erklärung-Test' })
  const { event } = (await response.json()) as { event: EventSummary }
  createdEventIds.push(event.id)
  return event
}

function uploadImage(eventId: string, position: number, image: Buffer): Promise<Response> {
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'bild')
  return fetch(`${baseUrl}/api/admin/events/${eventId}/explainer/${position}/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
    .png()
    .toBuffer()
}

const texts = [
  { title: 'Foto', text: 'Mach ein Selfie.' },
  { title: 'Suchen', text: 'Finde dein Gegenüber im Raum.' },
  { title: 'Code', text: 'Zeig deinen Code, der andere wählt ihn aus.' },
]

/* ------------------------------------------------------------------- Tests */

describe('Spielerklärung', () => {
  it('ist anfangs leer und liefert trotzdem immer drei Schritte', async () => {
    const event = await createEvent()
    const detail = (await (
      await call('GET', `/api/admin/events/${event.id}`)
    ).json()) as AdminEventDetail
    expect(detail.explainer).toEqual([
      { title: '', text: '', imageUrl: null },
      { title: '', text: '', imageUrl: null },
      { title: '', text: '', imageUrl: null },
    ])
  })

  it('speichert Titel und Texte und lässt die Bilder dabei stehen', async () => {
    const event = await createEvent()
    await uploadImage(event.id, 1, await png(400, 300))

    const response = await call('PATCH', `/api/admin/events/${event.id}/explainer`, {
      steps: texts,
    })
    expect(response.status).toBe(200)
    const { explainer } = (await response.json()) as { explainer: ExplainerStep[] }
    expect(explainer.map(({ title, text }) => ({ title, text }))).toEqual(texts)
    expect(explainer[1]!.imageUrl).not.toBeNull()

    const detail = (await (
      await call('GET', `/api/admin/events/${event.id}`)
    ).json()) as AdminEventDetail
    expect(detail.explainer).toEqual(explainer)
  })

  it('verlangt genau drei Schritte und hält die Längen ein', async () => {
    const event = await createEvent()
    const path = `/api/admin/events/${event.id}/explainer`

    expect((await call('PATCH', path, { steps: texts.slice(0, 2) })).status).toBe(400)
    expect(
      (
        await call('PATCH', path, {
          steps: [...texts.slice(0, 2), { title: 'x'.repeat(61), text: '' }],
        })
      ).status,
    ).toBe(400)
  })

  it('verkleinert ein Bild und liefert es öffentlich unter einer dauerhaften Adresse aus', async () => {
    const event = await createEvent()

    const response = await uploadImage(event.id, 0, await png(3000, 2000))
    expect(response.status).toBe(200)
    const { explainer } = (await response.json()) as { explainer: ExplainerStep[] }
    const url = explainer[0]!.imageUrl!
    expect(url).toMatch(new RegExp(`^/api/events/${event.slug}/explainer/0\\?v=[0-9a-f]+$`))

    const image = await fetch(`${baseUrl}${url}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('cache-control')).toContain('immutable')
    const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(800)
  })

  it('räumt das alte Bild beim Ersetzen und Entfernen aus dem Speicher', async () => {
    const event = await createEvent()
    const keyOf = async () =>
      (await db.select().from(explainerSteps).where(eq(explainerSteps.eventId, event.id)))[0]!
        .imageKey

    await uploadImage(event.id, 2, await png(200, 200))
    const first = await keyOf()
    await uploadImage(event.id, 2, await png(300, 300))
    const second = await keyOf()
    expect(second).not.toBe(first)
    await expect(photoStorage.read(first!)).rejects.toThrow()

    const removed = await call('DELETE', `/api/admin/events/${event.id}/explainer/2/image`)
    const { explainer } = (await removed.json()) as { explainer: ExplainerStep[] }
    expect(explainer[2]!.imageUrl).toBeNull()
    await expect(photoStorage.read(second!)).rejects.toThrow()
    expect((await fetch(`${baseUrl}/api/events/${event.slug}/explainer/2`)).status).toBe(404)
  })

  it('kennt nur die Plätze 0 bis 2', async () => {
    const event = await createEvent()
    expect((await uploadImage(event.id, 3, await png(10, 10))).status).toBe(400)
  })

  it('verlangt eine Anmeldung', async () => {
    const event = await createEvent()
    const anonymous = await fetch(`${baseUrl}/api/admin/events/${event.id}/explainer`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: texts }),
    })
    expect(anonymous.status).toBe(401)
  })
})
