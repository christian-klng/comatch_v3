import type { MeResponse } from '@comatch/core'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { requireParticipant } from '../auth.js'
import { db } from '../db/index.js'
import { events, games, participants } from '../db/schema.js'
import type { GameEngine } from '../game/engine.js'
import { loadMatches } from '../game/matches.js'
import { badRequest, notFound } from '../lib/errors.js'
import { createPhotoKey, photoStorage } from '../lib/storage.js'
import { toEventSummary, toGame, toParticipant } from '../serialize.js'

/** Kantenlänge des gespeicherten Fotos. Im Eventnetz zählt jedes Kilobyte. */
const PHOTO_SIZE = 640

/**
 * Obergrenze für die Bildfläche vor dem Verkleinern. Ein kleines, stark
 * komprimiertes Bild kann sich beim Dekodieren zu Gigabyte aufblähen — 50 Megapixel
 * liegen weit über jedem Handyfoto und weit unter dem, was gefährlich wird.
 */
const MAX_INPUT_PIXELS = 50_000_000

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  profile: z
    .object({
      company: z.string().trim().max(80).optional(),
      role: z.string().trim().max(80).optional(),
      linkedin: z.string().trim().max(200).optional(),
    })
    .optional(),
  /** Ergebnis der Kalibrierung im Onboarding — nur zur Auswertung der Trefferquote. */
  bumpThreshold: z.number().positive().max(100).optional(),
})

export function registerParticipantRoutes(app: FastifyInstance, ctx: { engine: GameEngine }): void {
  app.get('/api/participants/me', async (request): Promise<MeResponse> => {
    const me = await requireParticipant(request)

    const [event] = await db.select().from(events).where(eq(events.id, me.eventId)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht mehr.')

    const [game] = await db
      .select()
      .from(games)
      .where(and(eq(games.eventId, me.eventId), inArray(games.state, ['running', 'paused'])))
      .limit(1)

    return {
      participant: await toParticipant(me),
      event: toEventSummary(event),
      activeGame: game ? toGame(game) : null,
      matches: await loadMatches(db, me.id),
    }
  })

  app.patch('/api/participants/me', async (request) => {
    const me = await requireParticipant(request)
    const body = updateSchema.parse(request.body)

    const [row] = await db
      .update(participants)
      .set({
        ...(body.displayName ? { displayName: body.displayName } : {}),
        ...(body.profile ? { profile: body.profile } : {}),
        ...(body.bumpThreshold ? { bumpThreshold: body.bumpThreshold } : {}),
      })
      .where(eq(participants.id, me.id))
      .returning()

    await ctx.engine.pushState(me.id)
    return toParticipant(row!)
  })

  /**
   * Selfie hochladen.
   *
   * Serverseitig verkleinert und nach WebP umgewandelt: Ein iPhone-Foto wiegt roh
   * gern 4 MB, und alle anderen im Raum müssen es später über dasselbe überlastete
   * WLAN laden. `rotate()` wertet die EXIF-Orientierung aus — ohne das steht die
   * Hälfte der Selfies auf dem Kopf.
   */
  app.post('/api/participants/me/photo', async (request) => {
    const me = await requireParticipant(request)

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
        .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: sharp.strategy.attention })
        .webp({ quality: 80 })
        .toBuffer()
    } catch {
      throw badRequest('broken_image', 'Das Bild konnte nicht verarbeitet werden.')
    }

    const key = createPhotoKey(me.id)
    await photoStorage.put(key, processed, 'image/webp')

    // Ein ausgetauschtes Foto lässt das alte sonst für immer im Speicher liegen.
    const previousKey = me.photoKey

    const [row] = await db
      .update(participants)
      .set({
        photoKey: key,
        // Mit dem Foto ist das Onboarding durch — ab jetzt zählt die Person mit.
        ...(me.state === 'onboarding' ? { state: 'waiting' as const } : {}),
      })
      .where(eq(participants.id, me.id))
      .returning()

    if (previousKey) await photoStorage.remove([previousKey])

    await ctx.engine.pushState(me.id)
    return { photoUrl: (await toParticipant(row!)).photoUrl }
  })

  /**
   * Eigene Daten löschen (DSGVO).
   *
   * Foto, Vorname und Profil verschwinden, die Zeile bleibt als anonymer Platzhalter
   * bestehen — sonst würden per Kaskade auch die Paare der anderen Teilnehmer
   * verschwinden und deren Match-Zähler nachträglich sinken.
   */
  app.delete('/api/participants/me', async (request, reply) => {
    const me = await requireParticipant(request)

    if (me.photoKey) await photoStorage.remove([me.photoKey])
    await db
      .update(participants)
      .set({
        displayName: 'Gelöscht',
        photoKey: null,
        profile: {},
        state: 'offline',
        deletedAt: new Date(),
      })
      .where(eq(participants.id, me.id))

    await ctx.engine.handleOffline(me.id)
    reply.code(204)
  })
}
