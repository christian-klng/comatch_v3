import {
  DEFAULT_FIND_ME_CONFIG,
  LOCALES,
  SERVER_EVENT,
  eventDesignSchema,
  isSameDesign,
  type AdminEventDetail,
} from '@comatch/core'
import { desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { clearAdminCookie, createAdminToken, requireAdmin, setAdminCookie } from '../auth.js'
import { db } from '../db/index.js'
import { admins, events, games, participants, type GameRow } from '../db/schema.js'
import { env } from '../env.js'
import type { GameEngine } from '../game/engine.js'
import {
  computeEventStats,
  computeGameStats,
  listParticipants,
  listRecentMatches,
} from '../game/stats.js'
import { purgeEvent } from '../jobs/retention.js'
import { loadExplainer } from './admin.explainer.js'
import { createEventSlug, verifyPassword } from '../lib/crypto.js'
import { eraseParticipantsById } from '../lib/erase.js'
import { conflict, notFound, unauthorized } from '../lib/errors.js'
import type { Hub } from '../realtime/hub.js'
import { toEventSummary, toGame } from '../serialize.js'

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  design: eventDesignSchema.nullish(),
})

const updateEventSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    archived: z.boolean().optional(),
    locale: z.enum(LOCALES).optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    design: eventDesignSchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nichts zu ändern.',
  })

const startCountdownSchema = z.object({
  seconds: z.number().int().min(1).max(120),
})

const setStateSchema = z.object({
  state: z.enum(['running', 'paused']),
})

export function registerAdminRoutes(
  app: FastifyInstance,
  ctx: { engine: GameEngine; hub: Hub },
): void {
  /*
   * Laufende Countdowns vor einem Spielstart, je Event.
   *
   * Auf dem Server statt im Browser: Im Leinwand-Modus zeigt meist ein anderer Tab
   * oder Rechner die Eventseite als der, in dem der Admin auf „Starten" drückt — ein
   * Countdown im Browser käme auf der Leinwand nie an. Er lebt nur im Arbeitsspeicher,
   * wie der Spieltakt: Nach einem Neustart ist er weg, und der Admin startet neu.
   */
  const countdowns = new Map<string, { endsAt: number; timer: ReturnType<typeof setTimeout> }>()

  function cancelCountdown(eventId: string): void {
    const running = countdowns.get(eventId)
    if (running) clearTimeout(running.timer)
    countdowns.delete(eventId)
  }

  app.addHook('onClose', async () => {
    for (const eventId of [...countdowns.keys()]) cancelCountdown(eventId)
  })

  async function findGame(eventId: string): Promise<GameRow | undefined> {
    const [game] = await db.select().from(games).where(eq(games.eventId, eventId)).limit(1)
    return game
  }

  async function requireOpenEvent(eventId: string) {
    const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')
    if (event.archivedAt) {
      throw conflict('event_archived', 'In einem archivierten Event startet kein Spiel.')
    }
    return event
  }

  /**
   * Das Spiel zum ersten Mal starten — sofort über die Route oder am Ende eines
   * Countdowns. Die Zeile entsteht erst hier, mit der Standardkonfiguration.
   *
   * Ein Event hat genau ein Spiel; das erzwingt der Unique-Index auf `event_id`. Der
   * Upsert greift nur, solange das Spiel noch nie lief — ein zweiter Klick auf
   * „Starten" von einem zweiten Admin-Gerät läuft damit ins Leere.
   */
  async function startGame(eventId: string): Promise<GameRow> {
    const event = await requireOpenEvent(eventId)

    const now = new Date()
    const [started] = await db
      .insert(games)
      .values({
        eventId: event.id,
        state: 'running',
        config: DEFAULT_FIND_ME_CONFIG,
        startedAt: now,
      })
      .onConflictDoUpdate({
        target: games.eventId,
        set: { state: 'running', startedAt: now },
        setWhere: sql`${games.state} = 'idle'`,
      })
      .returning()
    if (!started) throw conflict('game_already_active', 'Das Spiel ist bereits gestartet.')

    await ctx.engine.syncGame(started.id)
    return started
  }

  /**
   * Läuft das Spiel, blockiert es Archivieren und Sofortlöschen: Mitten im Spiel
   * die Fotos zu löschen wäre kein Aufräumen, sondern ein Unfall. Ein pausiertes
   * Spiel hält nichts auf — es endet ohnehin mit dem Event.
   */
  async function refuseWhileRunning(eventId: string): Promise<void> {
    const game = await findGame(eventId)
    if (game?.state === 'running') {
      throw conflict('event_has_active_game', 'Pausiere zuerst das Spiel.')
    }
  }

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
        design: body.design ?? null,
        createdBy: admin.id,
      })
      .returning()

    reply.code(201)
    return { event: toEventSummary(row!) }
  })

  /**
   * Name, Sprache, Design oder Archivstatus ändern.
   *
   * Der Slug bleibt bei einer Umbenennung bewusst unangetastet: Er steckt in
   * gedruckten und projizierten QR-Codes — ein neuer Slug würde sie alle entwerten.
   */
  app.patch<{ Params: { id: string } }>('/api/admin/events/:id', async (request) => {
    await requireAdmin(request)
    const body = updateEventSchema.parse(request.body)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    if (body.archived === true) {
      await refuseWhileRunning(event.id)
      // Sonst wollte der Countdown gleich darauf in ein archiviertes Event starten.
      cancelCountdown(event.id)
    }

    const [updated] = await db
      .update(events)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.startsAt !== undefined
          ? { startsAt: body.startsAt ? new Date(body.startsAt) : null }
          : {}),
        ...(body.endsAt !== undefined
          ? { endsAt: body.endsAt ? new Date(body.endsAt) : null }
          : {}),
        ...(body.design !== undefined ? { design: body.design } : {}),
      })
      .where(eq(events.id, event.id))
      .returning()

    /*
     * Neue Sprache und neues Design gelten sofort auf den Handys im Saal, ohne Neuladen.
     * Nur bei einem echten Wechsel — ein Umbenennen soll nicht jedem Gerät eine Nachricht
     * schicken.
     */
    const localeChanged = body.locale !== undefined && body.locale !== event.locale
    const designChanged = body.design !== undefined && !isSameDesign(body.design, event.design)
    if (localeChanged || designChanged) {
      ctx.hub.toEvent(event.id, SERVER_EVENT.eventChanged, {
        ...(localeChanged ? { locale: body.locale } : {}),
        ...(designChanged ? { design: body.design } : {}),
      })
    }

    return { event: toEventSummary(updated!) }
  })

  app.get<{ Params: { id: string } }>('/api/admin/events/:id', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    const game = await findGame(event.id)
    const countdown = countdowns.get(event.id)

    const detail: AdminEventDetail = {
      event: toEventSummary(event),
      joinUrl: `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/e/${event.slug}`,
      game: game ? { ...toGame(game), stats: await computeGameStats(db, event.id) } : null,
      startCountdown: countdown
        ? { remainingMs: Math.max(0, countdown.endsAt - Date.now()) }
        : null,
      explainer: await loadExplainer(event),
      participants: await listParticipants(db, event.id),
      stats: await computeEventStats(db, event.id),
      recentMatches: await listRecentMatches(db, event.id),
      dataRetentionHours: env.DATA_RETENTION_HOURS,
    }
    return detail
  })

  /**
   * Countdown vor dem Spielstart; nach Ablauf startet der Server das Spiel selbst.
   *
   * Geprüft wird schon hier und nicht erst beim Start: Eine Absage soll der Admin
   * sofort sehen, nicht nach zwanzig Sekunden auf der Leinwand.
   */
  app.post<{ Params: { id: string } }>(
    '/api/admin/events/:id/countdown',
    async (request, reply) => {
      await requireAdmin(request)
      const { seconds } = startCountdownSchema.parse(request.body)

      const event = await requireOpenEvent(request.params.id)
      const game = await findGame(event.id)
      if (game && game.state !== 'idle') {
        throw conflict('game_already_active', 'Das Spiel ist bereits gestartet.')
      }
      if (countdowns.has(event.id)) {
        throw conflict('countdown_running', 'Der Countdown läuft bereits.')
      }

      const durationMs = seconds * 1_000
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        void startGame(event.id)
          .catch((error: unknown) =>
            app.log.error(
              { err: error, eventId: event.id },
              'Spielstart nach Countdown fehlgeschlagen',
            ),
          )
          .finally(() => {
            // Erst nach dem Start austragen: Bis dahin zeigt die Eventseite „0" statt
            // kurz wieder den Startknopf. Und nur den eigenen Eintrag, nie einen neueren.
            if (countdowns.get(event.id)?.timer === timer) countdowns.delete(event.id)
          })
      }, durationMs)
      countdowns.set(event.id, { endsAt: Date.now() + durationMs, timer })

      reply.code(201)
      return { startCountdown: { remainingMs: durationMs } }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/events/:id/countdown',
    async (request, reply) => {
      await requireAdmin(request)
      cancelCountdown(request.params.id)
      reply.code(204)
    },
  )

  /**
   * Starten, Pausieren, Fortsetzen — ein Beenden gibt es nicht, das Spiel endet mit
   * dem Event. `running` auf ein noch nie gestartetes Spiel ist der Sofortstart.
   */
  app.post<{ Params: { id: string } }>('/api/admin/events/:id/game/state', async (request) => {
    await requireAdmin(request)
    const body = setStateSchema.parse(request.body)

    const game = await findGame(request.params.id)

    if (body.state === 'running') {
      if (!game || game.state === 'idle') {
        // Ein Sofortstart überholt einen laufenden Countdown — der liefe sonst gleich
        // darauf ins schon gestartete Spiel.
        cancelCountdown(request.params.id)
        return { game: toGame(await startGame(request.params.id)) }
      }
      await requireOpenEvent(request.params.id)
    }

    if (!game || game.state === 'idle') {
      throw notFound('game_not_found', 'Das Spiel wurde noch nicht gestartet.')
    }
    if (game.state === body.state) return { game: toGame(game) }

    const [updated] = await db
      .update(games)
      .set({ state: body.state })
      .where(eq(games.id, game.id))
      .returning()

    await ctx.engine.syncGame(game.id)
    return { game: toGame(updated!) }
  })

  /**
   * Personendaten sofort löschen, ohne auf die Frist zu warten.
   *
   * Archiviert das Event im selben Zug: Ohne Fotos und Namen ist es ohnehin nicht
   * mehr bespielbar, und die Archivierung hält die Frist für alle am Laufen, die
   * danach noch beitreten sollten. Ein laufendes Spiel muss vorher pausiert sein.
   */
  app.post<{ Params: { id: string } }>('/api/admin/events/:id/purge', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    await refuseWhileRunning(event.id)
    cancelCountdown(event.id)

    const { photos } = await purgeEvent(db, event.id)
    const [updated] = await db
      .update(events)
      .set({ archivedAt: event.archivedAt ?? new Date() })
      .where(eq(events.id, event.id))
      .returning()

    // Die Handys im Saal fliegen raus; ihr nächstes `hello` scheitert an `deletedAt`.
    ctx.hub.disconnectEvent(event.id)

    return { event: toEventSummary(updated!), photos }
  })

  /**
   * Einen Teilnehmer entfernen — etwa wegen eines Fotos, das nicht auf die Leinwand
   * gehört. Dieselbe Löschung wie die Selbstlöschung: Personendaten weg, Session
   * ungültig, Begegnungen bleiben als Zahl. Ein offenes Paar wird aufgelöst, damit
   * das Gegenüber nicht auf jemanden wartet, den es nicht mehr gibt.
   */
  app.delete<{ Params: { id: string } }>('/api/admin/participants/:id', async (request, reply) => {
    await requireAdmin(request)

    const [row] = await db
      .select({ id: participants.id, deletedAt: participants.deletedAt })
      .from(participants)
      .where(eq(participants.id, request.params.id))
      .limit(1)
    if (!row) throw notFound('participant_not_found', 'Diesen Teilnehmer gibt es nicht.')

    // Zweimal entfernen ist kein Fehler — der zweite Klick kommt von einem zweiten Gerät.
    if (!row.deletedAt) {
      await eraseParticipantsById(db, [row.id], 'Entfernt')
      await ctx.engine.handleOffline(row.id)
      ctx.hub.disconnectParticipant(row.id)
    }

    reply.code(204)
  })

  /** Für die Live-Kacheln im Dashboard, ohne das ganze Event neu zu laden. */
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/stats', async (request) => {
    await requireAdmin(request)

    const [event] = await db.select().from(events).where(eq(events.id, request.params.id)).limit(1)
    if (!event) throw notFound('event_not_found', 'Dieses Event gibt es nicht.')

    return {
      stats: await computeEventStats(db, event.id),
      participants: await listParticipants(db, event.id),
    }
  })
}
