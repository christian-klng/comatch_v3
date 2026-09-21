import { DEFAULT_FIND_ME_CONFIG, type EventPublic } from '@comatch/core'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { events, games, participants } from '../db/schema.js'
import { createSessionToken, hashToken } from '../lib/crypto.js'
import { notFound } from '../lib/errors.js'
import { photoStorage } from '../lib/storage.js'
import { toEventSummary, toGame, toParticipant } from '../serialize.js'

const profileSchema = z.object({
  company: z.string().trim().max(80).optional(),
  role: z.string().trim().max(80).optional(),
  linkedin: z.string().trim().max(200).optional(),
})

const joinSchema = z.object({
  displayName: z.string().trim().min(1, 'Bitte einen Vornamen angeben.').max(40),
  profile: profileSchema.optional(),
})

export function registerPublicRoutes(app: FastifyInstance): void {
  /** Was ein Teilnehmer sieht, bevor er beitritt — nach dem Scan des QR-Codes. */
  app.get<{ Params: { slug: string } }>('/api/events/:slug', async (request) => {
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.slug, request.params.slug))
      .limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    const [game] = await db
      .select()
      .from(games)
      .where(and(eq(games.eventId, event.id), inArray(games.state, ['running', 'paused'])))
      .limit(1)

    const payload: EventPublic = {
      ...toEventSummary(event),
      activeGame: game ? toGame(game) : null,
    }
    return payload
  })

  /**
   * Das Logo des Events — öffentlich wie der Eventname, und das Einzige aus dem
   * Objektspeicher, das der Server selbst ausliefert. Die URL trägt den Schlüssel des
   * Uploads als `v`; ein neues Logo hat eine neue URL, die alte darf ewig im Cache liegen.
   */
  app.get<{ Params: { slug: string } }>('/api/events/:slug/logo', async (request, reply) => {
    const [event] = await db
      .select({ logoKey: events.logoKey })
      .from(events)
      .where(eq(events.slug, request.params.slug))
      .limit(1)
    if (!event?.logoKey) throw notFound('logo_not_found', 'Dieses Event hat kein Logo.')

    let body: Buffer
    try {
      body = await photoStorage.read(event.logoKey)
    } catch {
      throw notFound('logo_not_found', 'Dieses Event hat kein Logo.')
    }

    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    reply.type('image/webp')
    return body
  })

  /**
   * Beitritt. Bewusst ohne Konto und ohne E-Mail: Auf einem Event zählt jede
   * Sekunde zwischen Scan und Mitmachen. Das Token kommt einmal zurück und liegt
   * danach im localStorage des Geräts — in der Datenbank steht nur sein Hash.
   */
  app.post<{ Params: { slug: string } }>(
    '/api/events/:slug/participants',
    async (request, reply) => {
      const body = joinSchema.parse(request.body)

      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.slug, request.params.slug))
        .limit(1)
      if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

      const sessionToken = createSessionToken()
      const [row] = await db
        .insert(participants)
        .values({
          eventId: event.id,
          displayName: body.displayName,
          profile: body.profile ?? {},
          sessionTokenHash: hashToken(sessionToken),
          state: 'onboarding',
        })
        .returning()

      reply.code(201)
      return { participant: await toParticipant(row!), sessionToken }
    },
  )

  /** Ein neues Spiel bekommt diese Werte, sofern der Admin nichts anderes setzt. */
  app.get('/api/config/find-me-defaults', async () => DEFAULT_FIND_ME_CONFIG)
}
