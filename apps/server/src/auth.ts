import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db } from './db/index.js'
import { admins, participants, type AdminRow, type ParticipantRow } from './db/schema.js'
import { env, isProduction } from './env.js'
import { hashToken } from './lib/crypto.js'
import { unauthorized } from './lib/errors.js'

const ADMIN_COOKIE = 'comatch_admin'

/** Gültigkeit einer Admin-Anmeldung. Ein Eventabend passt bequem hinein. */
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Teilnehmer weisen sich mit einem Bearer-Token aus, das im localStorage liegt.
 * Kein Cookie: Die Teilnehmer-App und die API können in Produktion auf getrennten
 * Domains laufen, und ein Token im Header ist dabei das schlichtere Modell.
 */
export async function requireParticipant(request: FastifyRequest): Promise<ParticipantRow> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) throw unauthorized('Kein Session-Token.')

  const token = header.slice('Bearer '.length).trim()
  if (!token) throw unauthorized('Kein Session-Token.')

  const [row] = await db
    .select()
    .from(participants)
    .where(eq(participants.sessionTokenHash, hashToken(token)))
    .limit(1)

  if (!row) throw unauthorized('Session ist abgelaufen.')
  if (row.deletedAt) throw unauthorized('Dieser Zugang wurde gelöscht.')

  return row
}

/** Wie oben, aber ohne Fehler — für Routen, die mit und ohne Session funktionieren. */
export async function optionalParticipant(
  request: FastifyRequest,
): Promise<ParticipantRow | null> {
  try {
    return await requireParticipant(request)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------ Admin-Token */

/**
 * Signiertes Token für die Admin-Anmeldung.
 *
 * Ein httpOnly-Cookie wäre die sicherere Bauart — aber es funktioniert zwischen
 * Admin-App und API nicht, wenn beide auf getrennten Registrierungs-Domains liegen
 * (bei Railway ist jede `*.up.railway.app`-Subdomain eine eigene). Der Browser
 * behandelt das Cookie dann als Drittanbieter-Cookie, und Safari und Firefox
 * verwerfen es grundsätzlich. Die Anmeldung gelingt, die nächste Anfrage nicht —
 * ein Fehlerbild, das nach einem Serverfehler aussieht und keiner ist.
 *
 * Deshalb dasselbe Verfahren wie bei den Teilnehmern. Das Token trägt seine
 * Gültigkeit in sich und wird signiert, es braucht also keine Sitzungstabelle.
 * Der Preis: Ein ausgegebenes Token lässt sich nicht vorzeitig zurückziehen —
 * ein Abmelden verwirft es nur clientseitig. Bei einer Handvoll Admin-Zugängen
 * und zwölf Stunden Laufzeit ist das vertretbar; sollte es das einmal nicht mehr
 * sein, gehört hier eine Tabelle mit widerrufbaren Sitzungen hin.
 */
export function createAdminToken(adminId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ id: adminId, exp: Date.now() + ADMIN_TOKEN_TTL_MS }),
  ).toString('base64url')

  return `${payload}.${signPayload(payload)}`
}

function signPayload(payload: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url')
}

function verifyAdminToken(token: string): string | null {
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expected = Buffer.from(signPayload(payload))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      id?: string
      exp?: number
    }
    if (typeof data.id !== 'string' || typeof data.exp !== 'number') return null
    if (data.exp < Date.now()) return null
    return data.id
  } catch {
    return null
  }
}

/*
 * Das Cookie bleibt zusätzlich bestehen: Liegen Admin-App und API später einmal
 * unter derselben Domain (etwa admin.example.com und api.example.com), ist es die
 * bessere Variante und greift ohne weiteres Zutun.
 */
export function setAdminCookie(reply: FastifyReply, adminId: string): void {
  reply.setCookie(ADMIN_COOKIE, adminId, {
    signed: true,
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
}

export function clearAdminCookie(reply: FastifyReply): void {
  reply.clearCookie(ADMIN_COOKIE, { path: '/' })
}

/** Nimmt beide Wege an: Bearer-Token zuerst, Cookie als Rückfallebene. */
export async function requireAdmin(request: FastifyRequest): Promise<AdminRow> {
  const adminId = adminIdFromBearer(request) ?? adminIdFromCookie(request)
  if (!adminId) throw unauthorized()

  const [row] = await db.select().from(admins).where(eq(admins.id, adminId)).limit(1)
  if (!row) throw unauthorized()

  return row
}

function adminIdFromBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null

  const token = header.slice('Bearer '.length).trim()
  return token ? verifyAdminToken(token) : null
}

function adminIdFromCookie(request: FastifyRequest): string | null {
  const raw = request.cookies[ADMIN_COOKIE]
  if (!raw) return null

  const unsigned = request.unsignCookie(raw)
  return unsigned.valid && unsigned.value ? unsigned.value : null
}
