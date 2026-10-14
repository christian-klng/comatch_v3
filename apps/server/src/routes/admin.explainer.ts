import {
  EXPLAINER_STEP_COUNT,
  EXPLAINER_TEXT_MAX,
  EXPLAINER_TITLE_MAX,
  type ExplainerStep,
} from '@comatch/core'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { db } from '../db/index.js'
import { events, explainerSteps, type EventRow } from '../db/schema.js'
import { badRequest, notFound } from '../lib/errors.js'
import { createExplainerImageKey, photoStorage } from '../lib/storage.js'
import { toExplainer } from '../serialize.js'

/**
 * Ein Drittel der Leinwandbreite, doppelt für scharfe Beamer — größer wird ein Bild
 * der Erklärung nie gezeigt.
 */
const IMAGE_MAX_SIZE = 1200

/** Wie bei Fotos und Logo: Ein kleines, stark komprimiertes Bild darf sich nicht aufblähen. */
const MAX_INPUT_PIXELS = 50_000_000

const updateExplainerSchema = z.object({
  steps: z
    .array(
      z.object({
        title: z.string().trim().max(EXPLAINER_TITLE_MAX),
        text: z.string().trim().max(EXPLAINER_TEXT_MAX),
      }),
    )
    .length(EXPLAINER_STEP_COUNT),
})

const positionSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(EXPLAINER_STEP_COUNT - 1)

async function requireEvent(eventId: string): Promise<EventRow> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')
  return event
}

export async function loadExplainer(
  event: Pick<EventRow, 'id' | 'slug'>,
): Promise<ExplainerStep[]> {
  const rows = await db.select().from(explainerSteps).where(eq(explainerSteps.eventId, event.id))
  return toExplainer(event.slug, rows)
}

/**
 * Die Spielerklärung, die der Admin auf der Leinwand Schritt für Schritt einblendet.
 *
 * Texte und Bilder haben getrennte Aufrufe: Ein Bild geht sofort beim Auswählen hoch,
 * die Texte erst mit „Speichern". Weil jede Änderung nur ihre eigenen Spalten
 * schreibt, verliert keine die andere.
 */
export function registerAdminExplainerRoutes(app: FastifyInstance): void {
  app.patch<{ Params: { id: string } }>('/api/admin/events/:id/explainer', async (request) => {
    await requireAdmin(request)
    const body = updateExplainerSchema.parse(request.body)
    const event = await requireEvent(request.params.id)

    await db
      .insert(explainerSteps)
      .values(
        body.steps.map((step, position) => ({
          eventId: event.id,
          position,
          title: step.title,
          text: step.text,
        })),
      )
      .onConflictDoUpdate({
        target: [explainerSteps.eventId, explainerSteps.position],
        set: { title: sql`excluded.title`, text: sql`excluded.text` },
      })

    return { explainer: await loadExplainer(event) }
  })

  /**
   * Bild eines Schritts hochladen oder ersetzen. Verkleinert und nach WebP gewandelt
   * wie die Fotos; ein SVG wird gerastert und nie als SVG ausgeliefert.
   */
  app.post<{ Params: { id: string; position: string } }>(
    '/api/admin/events/:id/explainer/:position/image',
    async (request) => {
      await requireAdmin(request)
      const position = positionSchema.parse(request.params.position)
      const event = await requireEvent(request.params.id)

      const upload = await request.file()
      if (!upload) throw badRequest('no_file', 'Es wurde kein Bild mitgeschickt.')
      if (!upload.mimetype.startsWith('image/')) {
        throw badRequest('not_an_image', 'Bitte ein Bild hochladen.')
      }

      const input = await upload.toBuffer()
      let processed: Buffer
      try {
        processed = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize(IMAGE_MAX_SIZE, IMAGE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer()
      } catch {
        throw badRequest('broken_image', 'Das Bild konnte nicht verarbeitet werden.')
      }

      const key = createExplainerImageKey(event.id, position)
      await photoStorage.put(key, processed, 'image/webp')

      const [previous] = await db
        .select({ imageKey: explainerSteps.imageKey })
        .from(explainerSteps)
        .where(and(eq(explainerSteps.eventId, event.id), eq(explainerSteps.position, position)))
        .limit(1)

      await db
        .insert(explainerSteps)
        .values({ eventId: event.id, position, imageKey: key })
        .onConflictDoUpdate({
          target: [explainerSteps.eventId, explainerSteps.position],
          set: { imageKey: key },
        })

      // Ein ausgetauschtes Bild bliebe sonst für immer im Speicher liegen.
      if (previous?.imageKey) await photoStorage.remove([previous.imageKey])

      return { explainer: await loadExplainer(event) }
    },
  )

  app.delete<{ Params: { id: string; position: string } }>(
    '/api/admin/events/:id/explainer/:position/image',
    async (request) => {
      await requireAdmin(request)
      const position = positionSchema.parse(request.params.position)
      const event = await requireEvent(request.params.id)

      const [previous] = await db
        .select({ imageKey: explainerSteps.imageKey })
        .from(explainerSteps)
        .where(and(eq(explainerSteps.eventId, event.id), eq(explainerSteps.position, position)))
        .limit(1)

      if (previous?.imageKey) {
        await db
          .update(explainerSteps)
          .set({ imageKey: null })
          .where(and(eq(explainerSteps.eventId, event.id), eq(explainerSteps.position, position)))
        await photoStorage.remove([previous.imageKey])
      }

      return { explainer: await loadExplainer(event) }
    },
  )
}
