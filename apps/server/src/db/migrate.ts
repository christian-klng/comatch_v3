import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { closeDatabase, db } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))

try {
  await migrate(db, { migrationsFolder: resolve(here, '../../drizzle') })
  console.log('Migrationen angewendet.')
} finally {
  await closeDatabase()
}
