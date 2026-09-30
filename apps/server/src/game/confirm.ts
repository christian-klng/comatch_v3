import { SERVER_EVENT, buildCodeChoices, type SignalKind } from '@comatch/core'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/index.js'
import { games, pairs, participants, signals, type PairRow } from '../db/schema.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { partnerIdOf, toPartnerRevealed } from '../serialize.js'
import type { Hub } from '../realtime/hub.js'
import { ensureConfirmCode, takenConfirmCodes } from './codes.js'

export interface ConfirmInput {
  participantId: string
  pairId: string
}

export interface ChooseCodeInput extends ConfirmInput {
  code: string
}

export interface ChooseCodeResult {
  confirmed: boolean
  /** Beide Seiten des Paares — sie brauchen den neuen Stand, ob Treffer oder nicht. */
  notify: string[]
}

/**
 * „Wir haben uns gefunden“: Wer tippt, zeigt ab jetzt seinen Code, das Gegenüber
 * bekommt die Vorschläge.
 *
 * Tippen beide praktisch gleichzeitig, gewinnt die erste Aktualisierung — die
 * Bedingung auf `code_requested_by is null` entscheidet das in der Datenbank. Wer
 * verliert, wählt eben aus. Gibt die Personen zurück, die den neuen Stand brauchen.
 */
export async function requestConfirmation(db: Database, input: ConfirmInput): Promise<string[]> {
  const pair = await loadOpenPair(db, input)
  if (pair.codeRequestedBy) return []

  const code = await ensureConfirmCode(db, input.participantId)
  const choices = buildCodeChoices(code, await takenConfirmCodes(db, pair.eventId))

  const [updated] = await db
    .update(pairs)
    .set({ codeRequestedBy: input.participantId, codeChoices: choices })
    .where(and(eq(pairs.id, pair.id), eq(pairs.state, 'pending'), isNull(pairs.codeRequestedBy)))
    .returning()

  return updated ? [updated.aId, updated.bId] : []
}

/**
 * Das Gegenüber hat einen der Vorschläge gewählt.
 *
 * Jede Wahl landet als Signal in der Datenbank, auch die falsche: Die Quote der
 * Fehlgriffe zeigt nach dem Event, ob die Codes auf dem Handy gut lesbar waren.
 *
 * Ein Fehlgriff setzt die Bestätigung zurück, statt einfach weiterwählen zu lassen.
 * Sonst käme man mit drei Tipps auch ohne Blick auf das andere Handy ans Ziel.
 */
export async function chooseCode(
  db: Database,
  hub: Hub,
  input: ChooseCodeInput,
): Promise<ChooseCodeResult> {
  const pair = await loadOpenPair(db, input)
  const requester = pair.codeRequestedBy

  if (!requester || !pair.codeChoices) {
    throw conflict('confirm_not_requested', 'Hier wartet gerade kein Code auf eine Auswahl.')
  }
  if (requester === input.participantId) {
    throw badRequest('confirm_not_requested', 'Den eigenen Code wählt das Gegenüber aus.')
  }
  if (!pair.codeChoices.includes(input.code)) {
    throw badRequest('not_a_choice', 'Dieser Code stand nicht zur Auswahl.')
  }

  const [owner] = await db
    .select({ code: participants.confirmCode })
    .from(participants)
    .where(eq(participants.id, requester))
    .limit(1)
  const correct = owner?.code === input.code
  const notify = [pair.aId, pair.bId]

  // Nur die Wahl zu genau dieser Bestätigung zählt — nicht eine, die ein Reconnect überholt hat.
  const stillOpen = and(
    eq(pairs.id, pair.id),
    eq(pairs.state, 'pending'),
    eq(pairs.codeRequestedBy, requester),
  )

  if (!correct) {
    const [reset] = await db
      .update(pairs)
      .set({ codeRequestedBy: null, codeChoices: null, codeMisses: sql`${pairs.codeMisses} + 1` })
      .where(stillOpen)
      .returning({ id: pairs.id })
    if (reset) await recordChoice(db, pair.id, input.participantId, false)
    return { confirmed: false, notify: reset ? notify : [] }
  }

  /*
   * Zwei schnelle Tipps auf den richtigen Code würden den Match sonst doppelt zählen.
   * Die bedingte Aktualisierung auf `state = 'pending'` entscheidet das Rennen in der
   * Datenbank: Genau eine der beiden Anfragen bekommt eine Zeile zurück.
   */
  const [confirmedPair] = await db
    .update(pairs)
    .set({ state: 'confirmed', via: 'code', confirmedAt: new Date() })
    .where(stillOpen)
    .returning()
  if (!confirmedPair) return { confirmed: false, notify: [] }

  await recordChoice(db, pair.id, input.participantId, true)
  await db
    .update(participants)
    .set({ state: 'matched' })
    .where(sql`${participants.id} in (${pair.aId}, ${pair.bId})`)

  await announceMatch(db, hub, confirmedPair.id, 'code')
  return { confirmed: true, notify: [] }
}

/** Das Paar, sofern die Person dazugehört und es noch bestätigt werden kann. */
async function loadOpenPair(db: Database, input: ConfirmInput): Promise<PairRow> {
  const [row] = await db
    .select({ pair: pairs, gameState: games.state })
    .from(pairs)
    .innerJoin(games, eq(games.id, pairs.gameId))
    .where(eq(pairs.id, input.pairId))
    .limit(1)

  if (!row) throw notFound('no_active_pair', 'Dieses Paar gibt es nicht.')

  const { pair, gameState } = row
  if (pair.aId !== input.participantId && pair.bId !== input.participantId) {
    throw badRequest('no_active_pair', 'Du gehörst nicht zu diesem Paar.')
  }
  if (pair.state !== 'pending') {
    throw conflict('pair_not_pending', 'Dieses Paar ist nicht mehr offen.')
  }
  if (gameState !== 'running') {
    throw conflict('no_active_game', 'Das Spiel läuft gerade nicht.')
  }
  return pair
}

async function recordChoice(
  db: Database,
  pairId: string,
  participantId: string,
  matched: boolean,
): Promise<void> {
  await db.insert(signals).values({ pairId, participantId, kind: 'code', t: Date.now(), matched })
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
    .where(and(eq(pairs.state, 'confirmed'), sql`${participantId} in (${pairs.aId}, ${pairs.bId})`))

  return row?.total ?? 0
}
