import { eq } from 'drizzle-orm'
import { env } from '../env.js'
import { hashPassword } from '../lib/crypto.js'
import { closeDatabase, db } from './index.js'
import { admins } from './schema.js'

/**
 * Legt den ersten Admin an.
 *
 * Läuft bei jedem Containerstart mit und ist deshalb bewusst **anlegend, nicht
 * überschreibend**: Wer sein Passwort später ändert, soll es beim nächsten Deploy
 * nicht wieder auf den Wert aus der Umgebungsvariable zurückgesetzt bekommen.
 *
 * Zum absichtlichen Zurücksetzen: `npm run db:seed -- --force`.
 */
const force = process.argv.includes('--force')

if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  // Ohne Zugangsdaten ist nichts zu tun. Kein Fehler: Beim Containerstart läuft
  // dieses Skript unbesehen mit, und ein Abbruch würde den Server nicht hochkommen lassen.
  console.log('ADMIN_EMAIL/ADMIN_PASSWORD nicht gesetzt — kein Admin angelegt.')
  await closeDatabase()
  process.exit(0)
}

try {
  const [existing] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.email, env.ADMIN_EMAIL))
    .limit(1)

  if (existing && !force) {
    console.log(`Admin ${env.ADMIN_EMAIL} existiert bereits — unverändert gelassen.`)
  } else {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD)
    await db
      .insert(admins)
      .values({ email: env.ADMIN_EMAIL, passwordHash })
      .onConflictDoUpdate({ target: admins.email, set: { passwordHash } })

    console.log(`Admin ${existing ? 'zurückgesetzt' : 'angelegt'}: ${env.ADMIN_EMAIL}`)
  }
} finally {
  await closeDatabase()
}
