import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'

export function registerHealthRoutes(app: FastifyInstance): void {
  /** Ist der Prozess da? Beantwortet die Startprüfung der Plattform. */
  app.get('/health', async () => ({ ok: true }))

  /** Ist er auch arbeitsfähig? Erst mit Datenbank ist der Dienst wirklich bereit. */
  app.get('/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`)
      return { ok: true, database: 'up' }
    } catch (error) {
      reply.code(503)
      return { ok: false, database: 'down', error: (error as Error).message }
    }
  })
}
