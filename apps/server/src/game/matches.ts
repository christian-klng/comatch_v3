import type { MatchRecord } from '@comatch/core'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { pairs, participants } from '../db/schema.js'
import { partnerIdOf, toMatchRecord } from '../serialize.js'

/**
 * Die bestätigten Begegnungen eines Teilnehmers, neueste zuerst.
 *
 * Die Partnerzeilen werden gebündelt nachgeladen statt einzeln je Match — sonst
 * wächst die Abfragezahl mit dem Erfolg im Spiel.
 */
export async function loadMatches(db: Database, participantId: string): Promise<MatchRecord[]> {
  const confirmed = await db
    .select()
    .from(pairs)
    .where(
      and(eq(pairs.state, 'confirmed'), sql`${participantId} in (${pairs.aId}, ${pairs.bId})`),
    )
    .orderBy(desc(pairs.confirmedAt))

  if (confirmed.length === 0) return []

  const partnerRows = await db
    .select()
    .from(participants)
    .where(
      inArray(
        participants.id,
        confirmed.map((pair) => partnerIdOf(pair, participantId)),
      ),
    )
  const partnerById = new Map(partnerRows.map((row) => [row.id, row]))

  const matches: MatchRecord[] = []
  for (const pair of confirmed) {
    const partner = partnerById.get(partnerIdOf(pair, participantId))
    if (partner) matches.push(await toMatchRecord(pair, partner))
  }
  return matches
}
