import { randomConfirmCode } from '@comatch/core'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { participants } from '../db/schema.js'
import { isUniqueViolation } from '../lib/errors.js'

/**
 * Bei 5.000 möglichen Codes kollidiert selbst in einem vollen Saal kaum ein Wurf.
 * Die Grenze schützt nur davor, bei einem Fehler endlos weiterzuwürfeln.
 */
const MAX_ATTEMPTS = 20

/**
 * Liefert den Aktivierungscode dieser Person und vergibt ihn beim ersten Mal.
 *
 * Eindeutigkeit je Event sichert der Unique-Index, nicht eine Vorab-Prüfung: Zwei
 * gleichzeitige Beitritte könnten sonst beide denselben freien Code sehen. Die
 * Bedingung auf `confirm_code is null` macht den Aufruf wiederholbar — wer schon
 * einen Code hat, behält ihn.
 */
export async function ensureConfirmCode(db: Database, participantId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const [existing] = await db
      .select({ code: participants.confirmCode })
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1)
    if (!existing) throw new Error(`Teilnehmer ${participantId} gibt es nicht.`)
    if (existing.code) return existing.code

    try {
      const [updated] = await db
        .update(participants)
        .set({ confirmCode: randomConfirmCode() })
        .where(and(eq(participants.id, participantId), isNull(participants.confirmCode)))
        .returning({ code: participants.confirmCode })
      if (updated?.code) return updated.code
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
  }
  throw new Error(`Kein freier Aktivierungscode für ${participantId} gefunden.`)
}

/** Alle vergebenen Codes eines Events — die darf keine Auswahl als falschen Vorschlag zeigen. */
export async function takenConfirmCodes(db: Database, eventId: string): Promise<Set<string>> {
  const rows = await db
    .select({ code: participants.confirmCode })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), isNotNull(participants.confirmCode)))
  return new Set(rows.flatMap((row) => (row.code ? [row.code] : [])))
}
