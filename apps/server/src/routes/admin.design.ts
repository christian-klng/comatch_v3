import { SERVER_EVENT, eventDesignSchema, type LogoTone } from '@comatch/core'
import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { db } from '../db/index.js'
import { designTemplates, events } from '../db/schema.js'
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js'
import { createLogoKey, photoStorage } from '../lib/storage.js'
import type { Hub } from '../realtime/hub.js'
import { toDesignTemplate, toEventLogo, toEventSummary } from '../serialize.js'

/** Größte Fläche, die ein Logo auf Handy oder Leinwand je einnimmt — doppelt für scharfe Displays. */
const LOGO_MAX_WIDTH = 960
const LOGO_MAX_HEIGHT = 320

/** Wie bei den Fotos: Ein kleines, stark komprimiertes Bild darf sich nicht zu Gigabyte aufblähen. */
const MAX_INPUT_PIXELS = 50_000_000

const templateNameSchema = z.string().trim().min(1).max(60)

const createTemplateSchema = z.object({
  name: templateNameSchema,
  design: eventDesignSchema,
})

const updateTemplateSchema = z
  .object({
    name: templateNameSchema.optional(),
    design: eventDesignSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nichts zu ändern.',
  })

const nameTaken = () =>
  conflict('template_name_taken', 'Eine Vorlage mit diesem Namen gibt es schon.')

/**
 * Misst, ob ein Logo im Mittel hell oder dunkel ist — gewichtet nach Deckkraft, damit
 * der durchsichtige Rand nicht mitzählt. Ein Logo ganz ohne Transparenz bringt seinen
 * eigenen Hintergrund mit und gilt als gemischt: Es ist fast immer für Weiß gemacht.
 */
async function measureLogoTone(image: Buffer): Promise<LogoTone> {
  const { data, info } = await sharp(image)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })

  let weight = 0
  let lightWeight = 0
  let transparent = 0
  const pixels = info.width * info.height

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255
    if (alpha < 0.5) transparent += 1
    // Für die Frage „eher hell oder eher dunkel" reicht die Gamma-kodierte Näherung.
    const brightness = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    weight += alpha
    if (brightness >= 0.6) lightWeight += alpha
  }

  if (transparent / pixels < 0.02 || weight === 0) return 'mixed'

  const lightShare = lightWeight / weight
  if (lightShare >= 0.85) return 'light'
  if (lightShare <= 0.15) return 'dark'
  return 'mixed'
}

export function registerAdminDesignRoutes(app: FastifyInstance, ctx: { hub: Hub }): void {
  /**
   * Logo hochladen oder ersetzen.
   *
   * Wie die Fotos serverseitig verkleinert und nach WebP gewandelt — verlustfrei, weil
   * ein Logo aus harten Kanten besteht, die eine Fotokompression ausfranst. Ein SVG
   * wird dabei gerastert und nie als SVG ausgeliefert: Es kann Skripte enthalten.
   */
  app.post<{ Params: { id: string } }>('/api/admin/events/:id/logo', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    const upload = await request.file()
    if (!upload) throw badRequest('no_file', 'Es wurde kein Bild mitgeschickt.')
    if (!upload.mimetype.startsWith('image/')) {
      throw badRequest('not_an_image', 'Bitte ein Bild hochladen.')
    }

    const input = await upload.toBuffer()

    let processed: Buffer
    let tone: LogoTone
    try {
      processed = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
        .webp({ lossless: true })
        .toBuffer()
      tone = await measureLogoTone(processed)
    } catch {
      throw badRequest('broken_image', 'Das Bild konnte nicht verarbeitet werden.')
    }

    const key = createLogoKey(event.id)
    await photoStorage.put(key, processed, 'image/webp')

    const [updated] = await db
      .update(events)
      .set({ logoKey: key, logoTone: tone })
      .where(eq(events.id, event.id))
      .returning()

    // Ein ausgetauschtes Logo lässt das alte sonst für immer im Speicher liegen.
    if (event.logoKey) await photoStorage.remove([event.logoKey])

    ctx.hub.toEvent(event.id, SERVER_EVENT.eventChanged, { logo: toEventLogo(updated!) })
    return { event: toEventSummary(updated!) }
  })

  app.delete<{ Params: { id: string } }>('/api/admin/events/:id/logo', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')
    if (!event.logoKey) return { event: toEventSummary(event) }

    const [updated] = await db
      .update(events)
      .set({ logoKey: null, logoTone: null })
      .where(eq(events.id, event.id))
      .returning()

    await photoStorage.remove([event.logoKey])

    ctx.hub.toEvent(event.id, SERVER_EVENT.eventChanged, { logo: null })
    return { event: toEventSummary(updated!) }
  })

  /* ---------------------------------------------------------------- Vorlagen */

  /*
   * Vorlagen gehören allen Admins, so wie die Events auch. Dass ein Name nur einmal
   * vorkommt, erzwingt der Unique-Index in der Datenbank — nicht eine Prüfung hier.
   */

  app.get('/api/admin/design-templates', async (request) => {
    await requireAdmin(request)
    const rows = await db.select().from(designTemplates).orderBy(asc(designTemplates.name))
    return { templates: rows.map(toDesignTemplate) }
  })

  app.post('/api/admin/design-templates', async (request, reply) => {
    const admin = await requireAdmin(request)
    const body = createTemplateSchema.parse(request.body)

    let row
    try {
      ;[row] = await db
        .insert(designTemplates)
        .values({ name: body.name, design: body.design, createdBy: admin.id })
        .returning()
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken()
      throw error
    }

    reply.code(201)
    return { template: toDesignTemplate(row!) }
  })

  /** Überschreibt eine Vorlage. Events, die sie schon angewandt haben, tragen ihre eigene Kopie. */
  app.patch<{ Params: { id: string } }>('/api/admin/design-templates/:id', async (request) => {
    await requireAdmin(request)
    const body = updateTemplateSchema.parse(request.body)

    let row
    try {
      ;[row] = await db
        .update(designTemplates)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.design !== undefined ? { design: body.design } : {}),
        })
        .where(eq(designTemplates.id, request.params.id))
        .returning()
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken()
      throw error
    }

    if (!row) throw notFound('template_not_found', 'Diese Vorlage gibt es nicht.')
    return { template: toDesignTemplate(row) }
  })

  app.delete<{ Params: { id: string } }>(
    '/api/admin/design-templates/:id',
    async (request, reply) => {
      await requireAdmin(request)
      await db.delete(designTemplates).where(eq(designTemplates.id, request.params.id))
      reply.code(204)
    },
  )
}
