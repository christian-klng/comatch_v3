import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '../db/index.js'
import { events, participants } from '../db/schema.js'
import { env } from '../env.js'
import { photoStorage } from '../lib/storage.js'

/** Wie oft nach abgelaufenen Events gesucht wird. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/**
 * Löscht Personendaten abgelaufener Events.
 *
 * Ein Event erzeugt Fotos von Gesichtern — der sensibelste Teil dieser App. Nach
 * `DATA_RETENTION_HOURS` verschwinden Foto, Vorname und Profil.
 *
 * Was **bleibt**, sind die Zeilen selbst und die Paare: Würde man Teilnehmer
 * wirklich löschen, nähme die Kaskade die Paare mit, und die Auswertung des Events
 * (wie viele Begegnungen, wie gut trug die Bump-Erkennung) wäre nachträglich
 * verfälscht. Übrig bleibt ein anonymer Platzhalter ohne Personenbezug.
 */
export async function purgeExpiredEvents(
  db: Database,
  log: FastifyBaseLogger,
): Promise<{ events: number; photos: number }> {
  const cutoff = new Date(Date.now() - env.DATA_RETENTION_HOURS * 60 * 60 * 1000)

  const expired = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(and(isNotNull(events.endsAt), lt(events.endsAt, cutoff), isNull(events.purgedAt)))

  if (expired.length === 0) return { events: 0, photos: 0 }

  const eventIds = expired.map((row) => row.id)

  const withPhotos = await db
    .select({ photoKey: participants.photoKey })
    .from(participants)
    .where(and(inArray(participants.eventId, eventIds), isNotNull(participants.photoKey)))

  const keys = withPhotos.map((row) => row.photoKey).filter((key): key is string => key !== null)

  // Erst die Bilder aus dem Speicher, dann die Verweise: Andersherum bliebe bei
  // einem Fehler dazwischen ein Foto ohne Zeile für immer im Objektspeicher liegen.
  if (keys.length > 0) await photoStorage.remove(keys)

  await db
    .update(participants)
    .set({
      displayName: 'Teilnehmer',
      photoKey: null,
      profile: {},
      state: 'offline',
      deletedAt: new Date(),
    })
    .where(inArray(participants.eventId, eventIds))

  await db.update(events).set({ purgedAt: new Date() }).where(inArray(events.id, eventIds))

  log.info(
    { events: expired.map((row) => row.name), photos: keys.length },
    'Personendaten abgelaufener Events gelöscht',
  )

  return { events: expired.length, photos: keys.length }
}

/**
 * Startet den Aufräumjob.
 *
 * Läuft einmal direkt beim Start — nach einem längeren Ausfall soll nicht erst eine
 * Stunde vergehen, bis die Daten verschwinden.
 */
export function startRetentionJob(db: Database, log: FastifyBaseLogger): () => void {
  const run = () => {
    void purgeExpiredEvents(db, log).catch((error) =>
      log.error({ error }, 'Aufräumjob fehlgeschlagen'),
    )
  }

  run()
  const timer = setInterval(run, SWEEP_INTERVAL_MS)
  return () => clearInterval(timer)
}

/** Zählt, wie viele Events auf ihre Bereinigung warten — für Health-Checks. */
export async function pendingPurgeCount(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - env.DATA_RETENTION_HOURS * 60 * 60 * 1000)
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(events)
    .where(and(isNotNull(events.endsAt), lt(events.endsAt, cutoff), isNull(events.purgedAt)))

  return row?.total ?? 0
}

/** Nur für Tests: einzelnes Event sofort bereinigen. */
export async function purgeEvent(db: Database, eventId: string): Promise<void> {
  const rows = await db
    .select({ photoKey: participants.photoKey })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), isNotNull(participants.photoKey)))

  const keys = rows.map((row) => row.photoKey).filter((key): key is string => key !== null)
  if (keys.length > 0) await photoStorage.remove(keys)

  await db
    .update(participants)
    .set({
      displayName: 'Teilnehmer',
      photoKey: null,
      profile: {},
      state: 'offline',
      deletedAt: new Date(),
    })
    .where(eq(participants.eventId, eventId))

  await db.update(events).set({ purgedAt: new Date() }).where(eq(events.id, eventId))
}
