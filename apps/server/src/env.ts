import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/*
 * .env laden, bevor irgendetwas anderes läuft. In Produktion (Railway) kommen die
 * Werte aus der Plattform — dann findet sich keine Datei und das ist richtig so.
 */
const here = dirname(fileURLToPath(import.meta.url))
for (const candidate of [
  resolve(here, '../../../.env'), // src/ oder dist/ → Repo-Wurzel
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
]) {
  try {
    process.loadEnvFile(candidate)
    break
  } catch {
    // Nächster Kandidat.
  }
}

const csv = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 4000 statt 3000: Port 3000 ist die Voreinstellung praktisch jedes Node-Projekts
  // und auf einem Entwicklungsrechner schnell doppelt belegt.
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET muss mindestens 16 Zeichen haben'),

  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174')
    .transform(csv),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  DATA_RETENTION_HOURS: z.coerce.number().int().nonnegative().default(24),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  throw new Error(`Konfiguration unvollständig:\n${issues}\n\nVorlage: .env.example`)
}

export const env = parsed.data
export type Env = typeof env

export const isProduction = env.NODE_ENV === 'production'

/*
 * Der S3-Treiber braucht mehr als der lokale. Lieber beim Start hart scheitern als
 * mitten auf einem Event beim ersten Foto-Upload.
 */
if (env.STORAGE_DRIVER === 's3') {
  const missing = (
    ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
  ).filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=s3 verlangt zusätzlich: ${missing.join(', ')}`)
  }
}

if (isProduction && env.SESSION_SECRET.includes('dev-only')) {
  throw new Error('SESSION_SECRET ist noch der Entwicklungswert aus .env.example.')
}
