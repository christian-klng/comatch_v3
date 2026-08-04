import { defineConfig } from 'drizzle-kit'

// drizzle-kit lädt src/env.ts nicht — die .env muss hier eigenständig kommen.
for (const candidate of ['../../.env', '.env']) {
  try {
    process.loadEnvFile(candidate)
    break
  } catch {
    // Nächster Kandidat.
  }
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://comatch:comatch@localhost:5433/comatch',
  },
  strict: true,
  verbose: true,
})
