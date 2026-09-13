import { and, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { participants } from '../db/schema.js'
import { photoStorage } from './storage.js'

/**
 * Entfernt die Personendaten von Teilnehmern — und nur die.
 *
 * Die Zeilen bleiben als anonyme Platzhalter stehen: Ein echtes DELETE nähme per
 * Kaskade die Paare mit, und die Auswertung des Events (wie viele Begegnungen, wie
 * gut trug die Bump-Erkennung) wäre nachträglich verfälscht. `deletedAt` sperrt
 * zugleich die Session: Wer gelöscht ist, kommt weder über die API noch über den
 * Socket wieder herein.
 *
 * Drei Wege führen hierher — Selbstlöschung, Entfernen durch den Admin und der
 * Aufräumjob — und alle drei sollen exakt dasselbe tun.
 *
 * @param placeholder Anzeigename, der an die Stelle des Vornamens tritt.
 * @returns Zahl der gelöschten Fotos.
 */
export async function eraseParticipants(
  db: Database,
  where: SQL | undefined,
  placeholder: string,
): Promise<number> {
  // Nur, was noch nicht gelöscht ist: Ein bereits anonymer Platzhalter behält seinen Namen.
  const scope = and(where, isNull(participants.deletedAt))

  const withPhotos = await db
    .select({ photoKey: participants.photoKey })
    .from(participants)
    .where(and(scope, isNotNull(participants.photoKey)))
  const keys = withPhotos.map((row) => row.photoKey).filter((key): key is string => key !== null)

  // Erst die Bilder aus dem Speicher, dann die Verweise: Andersherum bliebe bei
  // einem Fehler dazwischen ein Foto ohne Zeile für immer im Objektspeicher liegen.
  if (keys.length > 0) await photoStorage.remove(keys)

  await db
    .update(participants)
    .set({
      displayName: placeholder,
      photoKey: null,
      profile: {},
      state: 'offline',
      deletedAt: new Date(),
    })
    .where(scope)

  return keys.length
}

/** Bequemer Aufruf für einzelne Teilnehmer. */
export function eraseParticipantsById(
  db: Database,
  ids: readonly string[],
  placeholder: string,
): Promise<number> {
  if (ids.length === 0) return Promise.resolve(0)
  return eraseParticipants(db, inArray(participants.id, [...ids]), placeholder)
}
