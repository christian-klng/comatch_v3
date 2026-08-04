import { env } from '../env.js'
import { hashPassword } from '../lib/crypto.js'
import { closeDatabase, db } from './index.js'
import { admins } from './schema.js'

if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  console.error('ADMIN_EMAIL und ADMIN_PASSWORD müssen in .env stehen.')
  process.exit(1)
}

try {
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD)

  const [admin] = await db
    .insert(admins)
    .values({ email: env.ADMIN_EMAIL, passwordHash })
    .onConflictDoUpdate({ target: admins.email, set: { passwordHash } })
    .returning()

  console.log(`Admin bereit: ${admin?.email}`)
} finally {
  await closeDatabase()
}
