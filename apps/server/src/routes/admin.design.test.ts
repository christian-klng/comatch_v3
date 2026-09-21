import { randomUUID } from 'node:crypto'
import {
  CLIENT_EVENT,
  DESIGN_PRESETS,
  SERVER_EVENT,
  type DesignTemplate,
  type ErrorAck,
  type EventChangedPayload,
  type EventPublic,
  type EventSummary,
  type HelloAck,
} from '@comatch/core'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { admins, designTemplates, events, participants } from '../db/schema.js'
import { createSessionToken, hashPassword, hashToken } from '../lib/crypto.js'
import { photoStorage } from '../lib/storage.js'
import { startServer, type RunningServer } from '../server.js'

/**
 * Das Design eines Events: vom Admin gesetzt, öffentlich lesbar, live auf den Handys —
 * samt Logo und wiederverwendbaren Vorlagen.
 *
 * Braucht ein laufendes Postgres: `npm run db:up && npm run db:migrate`.
 */

let server: RunningServer
let baseUrl: string
let token: string
const run = randomUUID().slice(0, 8)
const email = `test-${run}@comatch.test`
const createdEventIds: string[] = []
const createdTemplateIds: string[] = []
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
    const rows = await db
      .select({ logoKey: events.logoKey })
      .from(events)
      .where(inArray(events.id, createdEventIds))
    await photoStorage.remove(rows.flatMap((row) => (row.logoKey ? [row.logoKey] : [])))
    await db.delete(events).where(inArray(events.id, createdEventIds))
  }
  if (createdTemplateIds.length > 0) {
    await db.delete(designTemplates).where(inArray(designTemplates.id, createdTemplateIds))
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

async function createEvent(extra: Record<string, unknown> = {}): Promise<EventSummary> {
  const response = await call('POST', '/api/admin/events', { name: 'Design-Test', ...extra })
  expect(response.status).toBe(201)
  const { event } = (await response.json()) as { event: EventSummary }
  createdEventIds.push(event.id)
  return event
}

async function createTemplate(name: string, design = DESIGN_PRESETS.forest): Promise<Response> {
  const response = await call('POST', '/api/admin/design-templates', { name, design })
  if (response.status === 201) {
    const { template } = (await response.clone().json()) as { template: DesignTemplate }
    createdTemplateIds.push(template.id)
  }
  return response
}

function uploadLogo(eventId: string, image: Buffer, type = 'image/png'): Promise<Response> {
  const form = new FormData()
  form.append('logo', new Blob([new Uint8Array(image)], { type }), 'logo')
  return fetch(`${baseUrl}/api/admin/events/${eventId}/logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
}

/** Ein einfarbiges Zeichen auf durchsichtigem Grund — wie ein freigestelltes Logo. */
function logoPng(color: string, size = { width: 400, height: 200 }): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
    <rect x="10%" y="25%" width="80%" height="50%" rx="12" fill="${color}"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

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
    HelloAck | ErrorAck
  if (!ack.ok) throw new Error(`Begrüßung abgelehnt: ${ack.code}`)
  return { socket, ack }
}

/* ------------------------------------------------------------------- Tests */

describe('Event-Design', () => {
  it('startet im Standarddesign und ist nach dem Setzen auch öffentlich sichtbar', async () => {
    const event = await createEvent()
    expect(event.design).toBeNull()
    expect(event.logo).toBeNull()

    const updated = await call('PATCH', `/api/admin/events/${event.id}`, {
      design: { ...DESIGN_PRESETS.berry, accent: '#FF5CA8' },
    })
    expect(updated.status).toBe(200)
    // Die Schreibweise wird vereinheitlicht, sonst gälte dasselbe Design als geändert.
    expect(((await updated.json()) as { event: EventSummary }).event.design).toEqual(
      DESIGN_PRESETS.berry,
    )

    const publicView = await fetch(`${baseUrl}/api/events/${event.slug}`)
    expect(((await publicView.json()) as EventPublic).design).toEqual(DESIGN_PRESETS.berry)

    const reset = await call('PATCH', `/api/admin/events/${event.id}`, { design: null })
    expect(((await reset.json()) as { event: EventSummary }).event.design).toBeNull()
  })

  it('übernimmt ein Design schon beim Anlegen', async () => {
    const event = await createEvent({ design: DESIGN_PRESETS.paper })
    expect(event.design).toEqual(DESIGN_PRESETS.paper)
  })

  it('lehnt alles ab, was kein vollständiges Design ist', async () => {
    const event = await createEvent()

    for (const design of [
      { ...DESIGN_PRESETS.midnight, accent: 'red' },
      { ...DESIGN_PRESETS.midnight, background: '#fff' },
      { ...DESIGN_PRESETS.midnight, font: 'comic-sans' },
      { background: '#000000', accent: '#ffffff' },
    ]) {
      const response = await call('PATCH', `/api/admin/events/${event.id}`, { design })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { code: string }).code).toBe('invalid_payload')
    }
  })

  it('kommt mit der Begrüßung und bei jedem echten Wechsel sofort auf die Handys', async () => {
    const event = await createEvent({ design: DESIGN_PRESETS.forest })
    const { socket, ack } = await connectParticipant(event.id)
    expect(ack.eventDesign).toEqual(DESIGN_PRESETS.forest)
    expect(ack.eventLogo).toBeNull()

    const received: EventChangedPayload[] = []
    socket.on(SERVER_EVENT.eventChanged, (payload: EventChangedPayload) => received.push(payload))

    await call('PATCH', `/api/admin/events/${event.id}`, { design: DESIGN_PRESETS.berry })
    // Derselbe Wert noch einmal darf keine Nachricht auslösen.
    await call('PATCH', `/api/admin/events/${event.id}`, { design: DESIGN_PRESETS.berry })
    await call('PATCH', `/api/admin/events/${event.id}`, { design: null })
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(received).toEqual([{ design: DESIGN_PRESETS.berry }, { design: null }])
  })
})

describe('Event-Logo', () => {
  it('wird verkleinert, vermessen und unter einer dauerhaften Adresse ausgeliefert', async () => {
    const event = await createEvent()
    const { socket } = await connectParticipant(event.id)
    const received: EventChangedPayload[] = []
    socket.on(SERVER_EVENT.eventChanged, (payload: EventChangedPayload) => received.push(payload))

    const response = await uploadLogo(
      event.id,
      await logoPng('#101418', { width: 3000, height: 1500 }),
    )
    expect(response.status).toBe(200)
    const { logo } = ((await response.json()) as { event: EventSummary }).event
    expect(logo?.tone).toBe('dark')
    expect(logo?.url).toMatch(new RegExp(`^/api/events/${event.slug}/logo\\?v=[0-9a-f]+$`))

    // Ohne Anmeldung abrufbar — das Logo ist so öffentlich wie der Eventname.
    const image = await fetch(`${baseUrl}${logo!.url}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('cache-control')).toContain('immutable')

    const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBeLessThanOrEqual(960)
    expect(meta.height).toBeLessThanOrEqual(320)
    expect(meta.hasAlpha).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(received).toEqual([{ logo }])
  })

  it('erkennt helle, dunkle und gemischte Logos', async () => {
    const event = await createEvent()
    const toneOf = async (image: Buffer, type?: string) => {
      const response = await uploadLogo(event.id, image, type)
      expect(response.status).toBe(200)
      return ((await response.json()) as { event: EventSummary }).event.logo?.tone
    }

    expect(await toneOf(await logoPng('#ffffff'))).toBe('light')
    expect(await toneOf(await logoPng('#0b0d13'))).toBe('dark')

    // Ohne Transparenz bringt das Logo seinen eigenen Hintergrund mit.
    const opaque = await sharp({
      create: { width: 300, height: 120, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()
    expect(await toneOf(opaque, 'image/jpeg')).toBe('mixed')
  })

  it('rastert ein SVG, statt es als SVG auszuliefern', async () => {
    const event = await createEvent()
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
        <script>alert(1)</script><circle cx="40" cy="40" r="30" fill="#ffffff"/></svg>`,
    )

    const response = await uploadLogo(event.id, svg, 'image/svg+xml')
    expect(response.status).toBe(200)
    const { logo } = ((await response.json()) as { event: EventSummary }).event

    const image = await fetch(`${baseUrl}${logo!.url}`)
    expect(image.headers.get('content-type')).toBe('image/webp')
    const body = Buffer.from(await image.arrayBuffer())
    expect(body.includes('script')).toBe(false)
  })

  it('räumt das alte Logo beim Ersetzen und Entfernen aus dem Speicher', async () => {
    const event = await createEvent()
    await uploadLogo(event.id, await logoPng('#ffffff'))
    const [first] = await db.select().from(events).where(eq(events.id, event.id))

    await uploadLogo(event.id, await logoPng('#000000'))
    const [second] = await db.select().from(events).where(eq(events.id, event.id))
    expect(second!.logoKey).not.toBe(first!.logoKey)
    await expect(photoStorage.read(first!.logoKey!)).rejects.toThrow()

    const removed = await call('DELETE', `/api/admin/events/${event.id}/logo`)
    expect(((await removed.json()) as { event: EventSummary }).event.logo).toBeNull()
    await expect(photoStorage.read(second!.logoKey!)).rejects.toThrow()

    const gone = await fetch(`${baseUrl}/api/events/${event.slug}/logo`)
    expect(gone.status).toBe(404)
  })

  it('lehnt ab, was kein Bild ist', async () => {
    const event = await createEvent()

    const text = await uploadLogo(event.id, Buffer.from('kein Bild'), 'text/plain')
    expect(text.status).toBe(400)
    expect(((await text.json()) as { code: string }).code).toBe('not_an_image')

    const broken = await uploadLogo(event.id, Buffer.from('kein Bild'), 'image/png')
    expect(broken.status).toBe(400)
    expect(((await broken.json()) as { code: string }).code).toBe('broken_image')
  })

  it('verlangt eine Anmeldung', async () => {
    const event = await createEvent()
    const form = new FormData()
    form.append('logo', new Blob([new Uint8Array(await logoPng('#fff'))], { type: 'image/png' }))

    const response = await fetch(`${baseUrl}/api/admin/events/${event.id}/logo`, {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(401)
  })
})

describe('Design-Vorlagen', () => {
  it('lassen sich speichern, auflisten, überschreiben und löschen', async () => {
    const created = await createTemplate(`Messe ${run}`)
    expect(created.status).toBe(201)
    const { template } = (await created.json()) as { template: DesignTemplate }
    expect(template.design).toEqual(DESIGN_PRESETS.forest)

    const list = await call('GET', '/api/admin/design-templates')
    const { templates } = (await list.json()) as { templates: DesignTemplate[] }
    expect(templates.map((entry) => entry.id)).toContain(template.id)

    const updated = await call('PATCH', `/api/admin/design-templates/${template.id}`, {
      design: DESIGN_PRESETS.berry,
    })
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { template: DesignTemplate }).template.design).toEqual(
      DESIGN_PRESETS.berry,
    )

    const removed = await call('DELETE', `/api/admin/design-templates/${template.id}`)
    expect(removed.status).toBe(204)

    const missing = await call('PATCH', `/api/admin/design-templates/${template.id}`, {
      name: 'egal',
    })
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { code: string }).code).toBe('template_not_found')
  })

  it('kennen jeden Namen nur einmal — unabhängig von der Schreibweise', async () => {
    expect((await createTemplate(`Sommerfest ${run}`)).status).toBe(201)

    const duplicate = await createTemplate(`SOMMERFEST ${run}`)
    expect(duplicate.status).toBe(409)
    expect(((await duplicate.json()) as { code: string }).code).toBe('template_name_taken')
  })

  it('färben kein Event um, das die Vorlage schon angewandt hat', async () => {
    const created = await createTemplate(`Kopie ${run}`, DESIGN_PRESETS.paper)
    const { template } = (await created.json()) as { template: DesignTemplate }
    const event = await createEvent({ design: template.design })

    await call('PATCH', `/api/admin/design-templates/${template.id}`, {
      design: DESIGN_PRESETS.berry,
    })

    const publicView = await fetch(`${baseUrl}/api/events/${event.slug}`)
    expect(((await publicView.json()) as EventPublic).design).toEqual(DESIGN_PRESETS.paper)
  })

  it('verlangen eine Anmeldung', async () => {
    const response = await fetch(`${baseUrl}/api/admin/design-templates`)
    expect(response.status).toBe(401)
  })
})
