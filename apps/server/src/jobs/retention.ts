import { and, eq, exists, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '../db/index.js'
import { events, pairs, participants } from '../db/schema.js'
import { env } from '../env.js'
import { eraseParticipants } from '../lib/erase.js'

/** Wie oft nach fälligen Events gesucht wird. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/**
 * Rückfallebene für Events ohne Enddatum, die auch niemand archiviert hat.
 *
 * Länger als die reguläre Frist, weil hier nur die letzte Aktivität als Anhaltspunkt
 * dient: Eine Konferenz mit einem freien Tag dazwischen soll nicht über Nacht ihre
 * Teilnehmer verlieren. Drei Tage Stille bedeuten aber sicher, dass das Event vorbei ist.
 */
export const INACTIVITY_FALLBACK_HOURS = 72

/** Der Platzhalter, der nach dem Aufräumen an der Stelle des Vornamens steht. */
const PLACEHOLDER = 'Teilnehmer'

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

/**
 * Welche Events sind fällig?
 *
 * Drei Auslöser, der erste, der zutrifft, zählt:
 *  1. Das Enddatum liegt länger als die Frist zurück.
 *  2. Das Event wurde vor mehr als der Frist archiviert — für Events, denen nie
 *     jemand ein Datum gegeben hat. Archivieren ist damit der verlässliche Weg,
 *     die Frist zu starten.
 *  3. Weder Datum noch Archiv, aber seit {@link INACTIVITY_FALLBACK_HOURS} kein
 *     Lebenszeichen: kein Beitritt, kein Heartbeat-Verlust, kein neues Paar.
 *
 * Fällig heißt außerdem: Es gibt noch etwas zu löschen. Ein Event, dem nach dem
 * Aufräumen wieder jemand beitritt — etwa weil es reaktiviert wurde —, wird beim
 * nächsten Lauf erneut bereinigt. `purgedAt` ist deshalb nur der Zeitpunkt des
 * letzten Aufräumens, keine Sperre — und ein Event, das nie Teilnehmer hatte,
 * bekommt keines: Es wurde ja nichts gelöscht.
 */
function dueCondition(): SQL {
  const cutoff = hoursAgo(env.DATA_RETENTION_HOURS)
  const inactivityCutoff = hoursAgo(INACTIVITY_FALLBACK_HOURS)

  const lastActivity = sql<Date>`greatest(
    ${events.createdAt},
    (select max(greatest(${participants.lastSeenAt}, ${participants.createdAt}))
       from ${participants} where ${participants.eventId} = ${events.id}),
    (select max(${pairs.createdAt}) from ${pairs} where ${pairs.eventId} = ${events.id})
  )`

  const expired = or(
    lt(events.endsAt, cutoff),
    lt(events.archivedAt, cutoff),
    // Als ISO-String mit Cast: Ein rohes Date im sql-Fragment kann der Treiber nicht binden.
    and(
      isNull(events.endsAt),
      isNull(events.archivedAt),
      sql`${lastActivity} < ${inactivityCutoff.toISOString()}::timestamptz`,
    ),
  )

  const somethingToErase = exists(
    sql`(select 1 from ${participants}
          where ${participants.eventId} = ${events.id}
            and ${participants.deletedAt} is null)`,
  )

  return and(expired, somethingToErase)!
}

/**
 * Löscht Personendaten fälliger Events.
 *
 * Ein Event erzeugt Fotos von Gesichtern — der sensibelste Teil dieser App. Nach
 * Ablauf der Frist verschwinden Foto, Vorname und Profil; die Zeilen und Paare
 * bleiben als anonyme Platzhalter für die Auswertung (siehe `eraseParticipants`).
 */
export async function purgeExpiredEvents(
  db: Database,
  log: FastifyBaseLogger,
): Promise<{ events: number; photos: number }> {
  const expired = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(dueCondition())

  if (expired.length === 0) return { events: 0, photos: 0 }

  const eventIds = expired.map((row) => row.id)
  const photos = await eraseParticipants(db, inArray(participants.eventId, eventIds), PLACEHOLDER)
  await db.update(events).set({ purgedAt: new Date() }).where(inArray(events.id, eventIds))

  log.info(
    { events: expired.map((row) => row.name), photos },
    'Personendaten abgelaufener Events gelöscht',
  )

  return { events: expired.length, photos }
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

/**
 * Ein einzelnes Event sofort bereinigen — auf Wunsch des Admins, ohne auf die
 * Frist zu warten. Dieselbe Löschung wie im Job, nur ohne Fälligkeitsprüfung.
 */
export async function purgeEvent(db: Database, eventId: string): Promise<{ photos: number }> {
  const photos = await eraseParticipants(db, eq(participants.eventId, eventId), PLACEHOLDER)
  await db.update(events).set({ purgedAt: new Date() }).where(eq(events.id, eventId))
  return { photos }
}
