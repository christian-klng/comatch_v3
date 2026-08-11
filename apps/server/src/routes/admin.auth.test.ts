import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { admins } from '../db/schema.js'
import { hashPassword } from '../lib/crypto.js'
import { startServer, type RunningServer } from '../server.js'

/**
 * Die Admin-Anmeldung, ohne Cookies.
 *
 * Diese Tests gibt es wegen eines Fehlers, der in Produktion auftrat und lokal
 * nicht: Admin-App und API lagen auf getrennten Registrierungs-Domains, das
 * httpOnly-Cookie war damit ein Drittanbieter-Cookie, und Safari verwarf es. Die
 * Anmeldung gelang — sie liest den Admin aus der Antwort —, der nächste Abruf
 * nicht. Deshalb prüft der erste Test ausdrücklich, dass die Anmeldung ohne
 * jegliches Cookie **vollständig** trägt.
 */

let server: RunningServer
let baseUrl: string
const email = `test-${randomUUID().slice(0, 8)}@comatch.test`
const password = 'ein-test-passwort'

beforeAll(async () => {
  server = await startServer({ port: 0 })
  baseUrl = `http://localhost:${server.port}`
  await db.insert(admins).values({ email, passwordHash: await hashPassword(password) })
}, 30_000)

afterAll(async () => {
  await db.delete(admins).where(eq(admins.email, email))
  await server?.close()
  await closeDatabase()
}, 30_000)

const login = () =>
  fetch(`${baseUrl}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

describe('Admin-Anmeldung', () => {
  it('trägt allein über das Token, ohne jedes Cookie', async () => {
    const response = await login()
    expect(response.status).toBe(200)

    const { admin, token } = (await response.json()) as { admin: { email: string }; token: string }
    expect(admin.email).toBe(email)
    expect(token).toBeTruthy()

    // Bewusst ohne Cookie-Weitergabe — genau so verhält sich Safari.
    const events = await fetch(`${baseUrl}/api/admin/events`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(events.status).toBe(200)

    const me = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(me.status).toBe(200)
  }, 30_000)

  it('setzt zusätzlich ein Cookie, falls App und API einmal dieselbe Domain teilen', async () => {
    const response = await login()
    const cookie = response.headers.get('set-cookie')

    expect(cookie).toContain('comatch_admin=')
    expect(cookie).toContain('HttpOnly')
  }, 30_000)

  it('weist ohne Anmeldung ab', async () => {
    const events = await fetch(`${baseUrl}/api/admin/events`)
    expect(events.status).toBe(401)
  }, 30_000)

  it('weist ein verfälschtes Token ab', async () => {
    const { token } = (await (await login()).json()) as { token: string }

    // Nutzlast verändern, Signatur behalten.
    const [payload, signature] = [token.slice(0, token.lastIndexOf('.')), token.split('.').pop()]
    const tampered = `${Buffer.from(JSON.stringify({ id: randomUUID(), exp: Date.now() + 60_000 })).toString('base64url')}.${signature}`

    expect(payload).toBeTruthy()
    const events = await fetch(`${baseUrl}/api/admin/events`, {
      headers: { Authorization: `Bearer ${tampered}` },
    })
    expect(events.status).toBe(401)
  }, 30_000)

  it('weist ein abgelaufenes Token ab', async () => {
    // Signatur mit demselben Geheimnis, aber vergangener Gültigkeit: Nur die
    // Ablaufprüfung kann das noch abfangen.
    const { createHmac } = await import('node:crypto')
    const { env } = await import('../env.js')
    const payload = Buffer.from(
      JSON.stringify({ id: randomUUID(), exp: Date.now() - 1_000 }),
    ).toString('base64url')
    const signature = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url')

    const events = await fetch(`${baseUrl}/api/admin/events`, {
      headers: { Authorization: `Bearer ${payload}.${signature}` },
    })
    expect(events.status).toBe(401)
  }, 30_000)

  it('weist ein falsches Passwort ab', async () => {
    const response = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'falsch' }),
    })
    expect(response.status).toBe(401)
  }, 30_000)
})
