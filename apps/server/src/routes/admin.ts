import {
  DEFAULT_FIND_ME_CONFIG,
  GAME_TYPES,
  type AdminEventDetail,
  type FindMeConfig,
} from '@comatch/core'
import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { clearAdminCookie, createAdminToken, requireAdmin, setAdminCookie } from '../auth.js'
import { db } from '../db/index.js'
import { admins, events, games } from '../db/schema.js'
import { env } from '../env.js'
import type { GameEngine } from '../game/engine.js'
import { computeStats, listParticipants } from '../game/stats.js'
import { createEventSlug, verifyPassword } from '../lib/crypto.js'
import { conflict, notFound, unauthorized } from '../lib/errors.js'
import { toEventSummary, toGame } from '../serialize.js'

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
})

const startGameSchema = z.object({
  type: z.enum(GAME_TYPES),
  config: z
    .object({
      tickIntervalMs: z.number().int().min(3_000).max(120_000).optional(),
      pairTimeoutMs: z.number().int().min(30_000).max(900_000).optional(),
      bumpWindowMs: z.number().int().min(200).max(5_000).optional(),
      minBumpMagnitude: z.number().min(1).max(50).optional(),
      allowManualConfirm: z.boolean().optional(),
      manualConfirmWindowMs: z.number().int().min(2_000).max(60_000).optional(),
      manualConfirmHintAfterMs: z.number().int().min(0).max(300_000).optional(),
    })
    .optional(),
})

const setStateSchema = z.object({
  state: z.enum(['running', 'paused', 'ended']),
})

/** Postgres meldet einen Verstoß gegen den Unique-Index mit diesem Code. */
const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION
}

export function registerAdminRoutes(app: FastifyInstance, ctx: { engine: GameEngine }): void {
  app.post('/api/admin/session', async (request, reply) => {
    const body = loginSchema.parse(request.body)

    const [admin] = await db.select().from(admins).where(eq(admins.email, body.email)).limit(1)
    /*
     * Auch ohne gefundenen Datensatz wird gehasht. Sonst antwortet die Route für
     * unbekannte Adressen messbar schneller und verrät damit, welche existieren.
     */
    const stored = admin?.passwordHash ?? 'scrypt$16384$8$1$AA$AA'
    const ok = await verifyPassword(body.password, stored)

    if (!admin || !ok) throw unauthorized('E-Mail oder Passwort stimmt nicht.')

    // Beide Wege: Das Token trägt die Anmeldung über Domain-Grenzen, das Cookie
    // greift, wenn App und API später einmal unter derselben Domain liegen.
    setAdminCookie(reply, admin.id)
    return {
      admin: { id: admin.id, email: admin.email },
      token: createAdminToken(admin.id),
    }
  })

  app.delete('/api/admin/session', async (_request, reply) => {
    clearAdminCookie(reply)
    reply.code(204)
  })

  app.get('/api/admin/me', async (request) => {
    const admin = await requireAdmin(request)
    return { admin: { id: admin.id, email: admin.email } }
  })

  app.get('/api/admin/events', async (request) => {
    await requireAdmin(request)
    const rows = await db.select().from(events).orderBy(desc(events.createdAt))
    return { events: rows.map(toEventSummary) }
  })

  app.post('/api/admin/events', async (request, reply) => {
    const admin = await requireAdmin(request)
    const body = createEventSchema.parse(request.body)

    const [row] = await db
      .insert(events)
      .values({
        slug: createEventSlug(body.name),
        name: body.name,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        createdBy: admin.id,
      })
      .returning()

    reply.code(201)
    return { event: toEventSummary(row!) }
  })

  app.get<{ Params: { id: string } }>('/api/admin/events/:id', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    const gameRows = await db
      .select()
      .from(games)
      .where(eq(games.eventId, event.id))
      .orderBy(desc(games.createdAt))

    const active = gameRows.find((game) => game.state === 'running' || game.state === 'paused')

    const detail: AdminEventDetail = {
      event: toEventSummary(event),
      joinUrl: `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/e/${event.slug}`,
      games: gameRows.map(toGame),
      activeGame: active ? toGame(active) : null,
      participants: await listParticipants(db, event.id),
      stats: await computeStats(db, event.id),
    }
    return detail
  })

  /**
   * Spiel starten.
   *
   * Dass immer nur eines läuft, erzwingt der partielle Unique-Index in der
   * Datenbank — nicht eine Prüfung hier. Ein zweiter Klick auf „Starten" von einem
   * zweiten Admin-Gerät läuft damit ins Leere statt in ein doppeltes Spiel.
   */
  app.post<{ Params: { id: string } }>('/api/admin/events/:id/games', async (request, reply) => {
    await requireAdmin(request)
    const body = startGameSchema.parse(request.body)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    const config: FindMeConfig = { ...DEFAULT_FIND_ME_CONFIG, ...body.config }

    let created
    try {
      ;[created] = await db
        .insert(games)
        .values({
          eventId: event.id,
          type: body.type,
          state: 'running',
          config,
          startedAt: new Date(),
        })
        .returning()
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('game_already_active', 'In diesem Event läuft bereits ein Spiel.')
      }
      throw error
    }

    await ctx.engine.syncGame(created!.id)

    reply.code(201)
    return { game: toGame(created!) }
  })

  app.post<{ Params: { id: string } }>('/api/admin/games/:id/state', async (request) => {
    await requireAdmin(request)
    const body = setStateSchema.parse(request.body)

    const [game] = await db.select().from(games).where(eq(games.id, request.params.id)).limit(1)
    if (!game) throw notFound('game_not_found', 'Dieses Spiel gibt es nicht.')
    if (game.state === 'ended') {
      throw conflict('game_ended', 'Ein beendetes Spiel lässt sich nicht wieder starten.')
    }

    const [updated] = await db
      .update(games)
      .set({
        state: body.state,
        ...(body.state === 'ended' ? { endedAt: new Date() } : {}),
        ...(body.state === 'running' && !game.startedAt ? { startedAt: new Date() } : {}),
      })
      .where(eq(games.id, game.id))
      .returning()

    await ctx.engine.syncGame(game.id)
    return { game: toGame(updated!) }
  })

  /** Für die Live-Kacheln im Dashboard, ohne das ganze Event neu zu laden. */
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/stats', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    return {
      stats: await computeStats(db, event.id),
      participants: await listParticipants(db, event.id),
    }
  })
}
