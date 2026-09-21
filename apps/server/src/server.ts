import type { FastifyInstance } from 'fastify'
import { createApp } from './app.js'
import { db } from './db/index.js'
import { env } from './env.js'
import { createGameEngine, type GameEngine } from './game/engine.js'
import { startRetentionJob } from './jobs/retention.js'
import { presence } from './lib/presence.js'
import { attachSocketHandlers, createHub, createSocketServer } from './realtime/index.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerAdminDesignRoutes } from './routes/admin.design.js'
import { registerParticipantRoutes } from './routes/participants.js'
import { registerPublicRoutes } from './routes/public.js'

export interface RunningServer {
  app: FastifyInstance
  engine: GameEngine
  /** Tatsächlich belegter Port — im Test wird 0 vergeben und hier zurückgemeldet. */
  port: number
  close(): Promise<void>
}

/**
 * Baut den Server zusammen und lauscht.
 *
 * Die Reihenfolge ist nicht beliebig: Socket.io hängt sich an den HTTP-Server von
 * Fastify, der Hub braucht Socket.io, der Spielmotor braucht den Hub, und die Routen
 * brauchen den Spielmotor. Erst danach darf gelauscht werden.
 */
export async function startServer(options: { port?: number } = {}): Promise<RunningServer> {
  const app = await createApp()

  const io = createSocketServer(app.server)
  const hub = createHub(io)
  const engine = createGameEngine({ db, hub, log: app.log })

  registerPublicRoutes(app)
  registerParticipantRoutes(app, { engine })
  registerAdminRoutes(app, { engine, hub })
  registerAdminDesignRoutes(app, { hub })
  attachSocketHandlers(io, engine, hub, app.log)

  await engine.resume()
  const stopRetention = startRetentionJob(db, app.log)

  await app.listen({ port: options.port ?? env.PORT, host: '0.0.0.0' })

  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : (options.port ?? env.PORT)

  return {
    app,
    engine,
    port,
    async close() {
      stopRetention()
      engine.shutdown()
      await io.close()
      await app.close()
      presence.clear()
    },
  }
}
