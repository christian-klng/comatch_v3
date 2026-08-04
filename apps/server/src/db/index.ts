import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema.js'

/*
 * Eine Verbindung pro Prozess. Der Matcher-Takt und die Socket-Handler teilen sich
 * denselben Pool — das ist gewollt, damit ein Takt nicht an einer erschöpften
 * Verbindungsliste hängen bleibt, während Teilnehmer beitreten.
 */
export const sqlClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
})

export const db = drizzle(sqlClient, { schema })

export type Database = typeof db

export async function closeDatabase(): Promise<void> {
  await sqlClient.end({ timeout: 5 })
}

export { schema }
