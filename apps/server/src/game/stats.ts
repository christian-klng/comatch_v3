import type {
  AdminMatchFeedItem,
  AdminMatchPerson,
  AdminParticipantRow,
  EventStats,
  GameRunStats,
} from '@comatch/core'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { pairs, participants } from '../db/schema.js'
import { presence } from '../lib/presence.js'
import { photoStorage } from '../lib/storage.js'

/** Eventweite Kennzahlen — Teilnehmer gehören zum Event, nicht zu einem Spiellauf. */
export async function computeEventStats(db: Database, eventId: string): Promise<EventStats> {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      waiting: sql<number>`count(*) filter (where ${participants.state} = 'waiting')::int`,
      searching: sql<number>`count(*) filter (where ${participants.state} = 'searching')::int`,
    })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), isNull(participants.deletedAt)))

  return {
    participantsTotal: counts?.total ?? 0,
    participantsOnline: presence.onlineCount(eventId),
    waiting: counts?.waiting ?? 0,
    searching: counts?.searching ?? 0,
  }
}

/** Für Spiele, in denen (noch) nichts bestätigt wurde. */
export const EMPTY_GAME_RUN_STATS: GameRunStats = {
  matchesConfirmed: 0,
  medianTimeToMatchMs: null,
  manualConfirmRatio: 0,
}

/**
 * Kennzahlen je Spiellauf, für alle Läufe eines Events in einer Abfrage.
 *
 * `manualConfirmRatio` ist die wichtigste Zahl: Sie sagt, wie oft die Bump-Erkennung
 * versagt hat und die Leute auf die Rückfallebene ausweichen mussten. Steigt sie,
 * gehören Schwelle und Zeitfenster nachgezogen.
 */
export async function computeGameRunStats(
  db: Database,
  eventId: string,
): Promise<Map<string, GameRunStats>> {
  const rows = await db
    .select({
      gameId: pairs.gameId,
      confirmed: sql<number>`count(*)::int`,
      manual: sql<number>`count(*) filter (where ${pairs.via} = 'manual')::int`,
      medianMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${pairs.confirmedAt} - ${pairs.createdAt})) * 1000)`,
    })
    .from(pairs)
    .where(and(eq(pairs.eventId, eventId), eq(pairs.state, 'confirmed')))
    .groupBy(pairs.gameId)

  return new Map(
    rows.map((row) => [
      row.gameId,
      {
        matchesConfirmed: row.confirmed,
        medianTimeToMatchMs: row.medianMs != null ? Math.round(row.medianMs) : null,
        manualConfirmRatio: row.confirmed > 0 ? row.manual / row.confirmed : 0,
      },
    ]),
  )
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

/** So viele Begegnungen zeigt der Live-Feed: genug für Bewegung auf der Leinwand, zu wenig zum Scrollen. */
const RECENT_MATCHES_LIMIT = 8

/**
 * Die jüngsten bestätigten Begegnungen für den Live-Feed, neueste zuerst.
 *
 * Wer seinen Zugang gelöscht hat, taucht nicht auf — und die Begegnung damit auch
 * nicht: Ein halbes Paar ohne Namen hätte auf einer Leinwand nichts zu suchen.
 */
export async function listRecentMatches(
  db: Database,
  eventId: string,
): Promise<AdminMatchFeedItem[]> {
  const rows = await db
    .select({ id: pairs.id, aId: pairs.aId, bId: pairs.bId, confirmedAt: pairs.confirmedAt })
    .from(pairs)
    .where(and(eq(pairs.eventId, eventId), eq(pairs.state, 'confirmed')))
    .orderBy(desc(pairs.confirmedAt))
    .limit(RECENT_MATCHES_LIMIT)
  if (rows.length === 0) return []

  const people = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
      photoKey: participants.photoKey,
    })
    .from(participants)
    .where(
      and(
        inArray(participants.id, [...new Set(rows.flatMap((row) => [row.aId, row.bId]))]),
        isNull(participants.deletedAt),
      ),
    )

  const byId = new Map(
    await Promise.all(
      people.map(async (person): Promise<[string, AdminMatchPerson]> => [
        person.id,
        {
          id: person.id,
          displayName: person.displayName,
          photoUrl: person.photoKey ? await photoStorage.signedUrl(person.photoKey) : null,
        },
      ]),
    ),
  )

  return rows.flatMap((row) => {
    const a = byId.get(row.aId)
    const b = byId.get(row.bId)
    if (!a || !b || !row.confirmedAt) return []
    return [{ pairId: row.id, confirmedAt: row.confirmedAt.toISOString(), a, b }]
  })
}
