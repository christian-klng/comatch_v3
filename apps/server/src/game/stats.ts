import type { AdminParticipantRow, GameStats } from '@comatch/core'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { pairs, participants } from '../db/schema.js'
import { presence } from '../lib/presence.js'
import { photoStorage } from '../lib/storage.js'

/**
 * Kennzahlen für das Admin-Dashboard.
 *
 * `manualConfirmRatio` ist die wichtigste Zahl: Sie sagt, wie oft die Bump-Erkennung
 * versagt hat und die Leute auf die Rückfallebene ausweichen mussten. Steigt sie,
 * gehören Schwelle und Zeitfenster nachgezogen.
 */
export async function computeStats(db: Database, eventId: string): Promise<GameStats> {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      waiting: sql<number>`count(*) filter (where ${participants.state} = 'waiting')::int`,
      searching: sql<number>`count(*) filter (where ${participants.state} = 'searching')::int`,
    })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), isNull(participants.deletedAt)))

  const [matches] = await db
    .select({
      confirmed: sql<number>`count(*)::int`,
      manual: sql<number>`count(*) filter (where ${pairs.via} = 'manual')::int`,
      medianMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${pairs.confirmedAt} - ${pairs.createdAt})) * 1000)`,
    })
    .from(pairs)
    .where(and(eq(pairs.eventId, eventId), eq(pairs.state, 'confirmed')))

  const confirmed = matches?.confirmed ?? 0

  return {
    participantsTotal: counts?.total ?? 0,
    participantsOnline: presence.onlineCount(eventId),
    waiting: counts?.waiting ?? 0,
    searching: counts?.searching ?? 0,
    matchesConfirmed: confirmed,
    medianTimeToMatchMs: matches?.medianMs != null ? Math.round(matches.medianMs) : null,
    manualConfirmRatio: confirmed > 0 ? (matches?.manual ?? 0) / confirmed : 0,
  }
}

/**
 * Wie viele bestätigte Begegnungen hat jeder Teilnehmer?
 *
 * Bewusst als eigene Abfrage und nicht als korrelierte Unterabfrage im `select`:
 * Drizzle rendert Spaltenverweise innerhalb eines `sql`-Fragments unqualifiziert.
 * `${participants.id}` wird dort zu schlichtem `"id"` — und weil die Unterabfrage
 * `from "pairs"` hat, bindet Postgres das an `pairs.id` statt an `participants.id`.
 * Das Ergebnis ist kein Fehler, sondern still immer null.
 *
 * Ein Event hat höchstens einige hundert bestätigte Paare; die in JS zu zählen ist
 * billiger als sich auf die Namensauflösung eines Query-Builders zu verlassen.
 */
async function countMatchesByParticipant(
  db: Database,
  eventId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ aId: pairs.aId, bId: pairs.bId })
    .from(pairs)
    .where(and(eq(pairs.eventId, eventId), eq(pairs.state, 'confirmed')))

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.aId, (counts.get(row.aId) ?? 0) + 1)
    counts.set(row.bId, (counts.get(row.bId) ?? 0) + 1)
  }
  return counts
}

export async function listParticipants(
  db: Database,
  eventId: string,
): Promise<AdminParticipantRow[]> {
  const [rows, matchCounts] = await Promise.all([
    db
      .select({
        id: participants.id,
        displayName: participants.displayName,
        photoKey: participants.photoKey,
        state: participants.state,
        createdAt: participants.createdAt,
      })
      .from(participants)
      .where(and(eq(participants.eventId, eventId), isNull(participants.deletedAt)))
      .orderBy(desc(participants.createdAt)),
    countMatchesByParticipant(db, eventId),
  ])

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      displayName: row.displayName,
      photoUrl: row.photoKey ? await photoStorage.signedUrl(row.photoKey) : null,
      state: row.state,
      online: presence.isOnline(row.id),
      matchCount: matchCounts.get(row.id) ?? 0,
      joinedAt: row.createdAt.toISOString(),
    })),
  )
}
