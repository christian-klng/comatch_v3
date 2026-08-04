import {
  SERVER_EVENT,
  bumpsMatch,
  type FindMeConfig,
  type SignalKind,
} from '@comatch/core'
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { games, pairs, participants, signals } from '../db/schema.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { partnerIdOf, toPartnerRevealed } from '../serialize.js'
import type { Hub } from '../realtime/hub.js'

export interface RecordSignalInput {
  participantId: string
  pairId: string
  kind: SignalKind
  /** Zeitpunkt auf dem Gerät, bereits in Serverzeit umgerechnet. */
  t: number
  magnitude?: number
}

export interface RecordSignalResult {
  confirmed: boolean
}

/**
 * Nimmt ein Bestätigungssignal entgegen und prüft, ob es zum Gegenstück des
 * Partners passt.
 *
 * Die Signale liegen in Postgres statt in einem Ringpuffer im Speicher. Das ist bei
 * einer Handvoll Signalen pro Match keine Last, spart eine zweite Wahrheitsquelle,
 * übersteht einen Reconnect mitten im Paar — und macht vor allem das Wettrennen
 * lösbar, wenn beide Stöße praktisch gleichzeitig eintreffen (siehe unten).
 */
export async function recordSignal(
  db: Database,
  hub: Hub,
  input: RecordSignalInput,
): Promise<RecordSignalResult> {
  const [row] = await db
    .select({ pair: pairs, config: games.config, gameState: games.state })
    .from(pairs)
    .innerJoin(games, eq(games.id, pairs.gameId))
    .where(eq(pairs.id, input.pairId))
    .limit(1)

  if (!row) throw notFound('no_active_pair', 'Dieses Paar gibt es nicht.')

  const { pair, config, gameState } = row

  if (pair.aId !== input.participantId && pair.bId !== input.participantId) {
    throw badRequest('no_active_pair', 'Du gehörst nicht zu diesem Paar.')
  }
  if (pair.state !== 'pending') {
    throw conflict('pair_not_pending', 'Dieses Paar ist nicht mehr offen.')
  }
  if (gameState !== 'running') {
    throw conflict('no_active_game', 'Das Spiel läuft gerade nicht.')
  }
  if (input.kind === 'manual' && !config.allowManualConfirm) {
    throw conflict('manual_confirm_disabled', 'Manuelle Bestätigung ist abgeschaltet.')
  }

  await db.insert(signals).values({
    pairId: pair.id,
    participantId: input.participantId,
    kind: input.kind,
    t: input.t,
    magnitude: input.magnitude ?? null,
  })

  const partner = await findMatchingPartnerSignal(db, {
    pair,
    config,
    input,
  })
  if (!partner) return { confirmed: false }

  /*
   * Beide Stöße treffen fast gleichzeitig ein — dann finden beide Handler das
   * Gegenstück des anderen und würden den Match doppelt zählen. Die bedingte
   * Aktualisierung auf `state = 'pending'` entscheidet das Rennen in der Datenbank:
   * Genau eine der beiden Anfragen bekommt eine Zeile zurück.
   */
  const [confirmedPair] = await db
    .update(pairs)
    .set({
      state: 'confirmed',
      via: input.kind,
      confirmedAt: new Date(),
    })
    .where(and(eq(pairs.id, pair.id), eq(pairs.state, 'pending')))
    .returning()

  if (!confirmedPair) return { confirmed: false }

  await db
    .update(signals)
    .set({ matched: true })
    .where(sql`${signals.id} in (${partner.signalId}, (
      select id from ${signals}
      where ${signals.pairId} = ${pair.id}
        and ${signals.participantId} = ${input.participantId}
      order by ${signals.receivedAt} desc
      limit 1
    ))`)

  await db
    .update(participants)
    .set({ state: 'matched' })
    .where(sql`${participants.id} in (${pair.aId}, ${pair.bId})`)

  await announceMatch(db, hub, confirmedPair.id, input.kind)
  return { confirmed: true }
}

async function findMatchingPartnerSignal(
  db: Database,
  args: {
    pair: { id: string; aId: string; bId: string }
    config: FindMeConfig
    input: RecordSignalInput
  },
): Promise<{ signalId: string } | null> {
  const { pair, config, input } = args

  const windowMs =
    input.kind === 'bump' ? config.bumpWindowMs : config.manualConfirmWindowMs

  const candidates = await db
    .select({ id: signals.id, t: signals.t, magnitude: signals.magnitude })
    .from(signals)
    .where(
      and(
        eq(signals.pairId, pair.id),
        ne(signals.participantId, input.participantId),
        eq(signals.kind, input.kind),
        eq(signals.matched, false),
        gte(signals.t, input.t - windowMs),
        lte(signals.t, input.t + windowMs),
      ),
    )
    .orderBy(signals.t)

  for (const candidate of candidates) {
    if (input.kind === 'manual') return { signalId: candidate.id }

    const fits = bumpsMatch(
      { t: input.t, magnitude: input.magnitude ?? 0 },
      { t: candidate.t, magnitude: candidate.magnitude ?? 0 },
      windowMs,
      config.minBumpMagnitude,
    )
    if (fits) return { signalId: candidate.id }
  }

  return null
}

/** Beide Seiten benachrichtigen — jede bekommt das Profil der jeweils anderen. */
async function announceMatch(
  db: Database,
  hub: Hub,
  pairId: string,
  via: SignalKind,
): Promise<void> {
  const [pair] = await db.select().from(pairs).where(eq(pairs.id, pairId)).limit(1)
  if (!pair) return

  const rows = await db
    .select()
    .from(participants)
    .where(sql`${participants.id} in (${pair.aId}, ${pair.bId})`)

  const byId = new Map(rows.map((row) => [row.id, row]))
  const confirmedAt = (pair.confirmedAt ?? new Date()).toISOString()

  for (const participantId of [pair.aId, pair.bId]) {
    const partnerRow = byId.get(partnerIdOf(pair, participantId))
    if (!partnerRow) continue

    hub.toParticipant(participantId, SERVER_EVENT.matchConfirmed, {
      pairId: pair.id,
      partner: await toPartnerRevealed(partnerRow),
      confirmedAt,
      via,
      totalMatches: await countMatches(db, participantId),
    })
  }
}

export async function countMatches(db: Database, participantId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(pairs)
    .where(
      and(
        eq(pairs.state, 'confirmed'),
        sql`${participantId} in (${pairs.aId}, ${pairs.bId})`,
      ),
    )

  return row?.total ?? 0
}
