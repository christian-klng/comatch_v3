import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db } from './db/index.js'
import { admins, participants, type AdminRow, type ParticipantRow } from './db/schema.js'
import { isProduction } from './env.js'
import { hashToken } from './lib/crypto.js'
import { unauthorized } from './lib/errors.js'

const ADMIN_COOKIE = 'comatch_admin'

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

/*
 * Admins bekommen ein signiertes httpOnly-Cookie: Die Admin-App läuft auf einer
 * Leinwand oder einem Laptop im Eventbetrieb, und ein Token im localStorage wäre
 * dort per XSS greifbar. SameSite=None (nur mit Secure, also HTTPS) erlaubt es,
 * Admin-App und API in Produktion auf getrennte Domains zu legen.
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

export async function requireAdmin(request: FastifyRequest): Promise<AdminRow> {
  const raw = request.cookies[ADMIN_COOKIE]
  if (!raw) throw unauthorized()

  const unsigned = request.unsignCookie(raw)
  if (!unsigned.valid || !unsigned.value) throw unauthorized()

  const [row] = await db.select().from(admins).where(eq(admins.id, unsigned.value)).limit(1)
  if (!row) throw unauthorized()

  return row
}
