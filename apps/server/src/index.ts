import { closeDatabase } from './db/index.js'
import { env } from './env.js'
import { startServer } from './server.js'

const server = await startServer()
server.app.log.info(`CoMatch-Server bereit auf Port ${server.port} (${env.NODE_ENV})`)

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  server.app.log.info({ signal }, 'Server wird beendet')
  try {
    await server.close()
    await closeDatabase()
  } catch (error) {
    server.app.log.error({ error }, 'Fehler beim Beenden')
  }

  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal))
}
