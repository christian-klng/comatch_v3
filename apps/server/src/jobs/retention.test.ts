import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDatabase, db } from '../db/index.js'
import { events, games, pairs, participants } from '../db/schema.js'
import { computeGameRunStats } from '../game/stats.js'
import { createSessionToken, hashToken } from '../lib/crypto.js'
import { purgeExpiredEvents } from './retention.js'

/**
 * Der Aufräumjob berührt Personendaten — hier darf nichts nach Gefühl laufen.
 *
 * Zwei Zusagen stehen gegeneinander und werden beide geprüft: Personendaten müssen
 * verschwinden, die Auswertung des Events muss überleben. Ein naives DELETE auf
 * `participants` würde per Kaskade die Paare mitnehmen und die zweite Zusage brechen.
 */

const createdEventIds: string[] = []
const log = {
  info: () => {},
  error: () => {},
} as unknown as Parameters<typeof purgeExpiredEvents>[1]

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await db.delete(events).where(inArray(events.id, createdEventIds))
  }
  await closeDatabase()
}, 30_000)

async function seedEvent(
  endsAt: Date | null,
  extra: { archivedAt?: Date; lastSeenAt?: Date; createdAt?: Date } = {},
) {
  const [event] = await db
    .insert(events)
    .values({
      slug: `purge-${randomUUID().slice(0, 8)}`,
      name: 'Vergangenes Event',
      endsAt,
      ...(extra.archivedAt ? { archivedAt: extra.archivedAt } : {}),
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    })
    .returning()
  createdEventIds.push(event!.id)

  const [game] = await db
    .insert(games)
    .values({
      eventId: event!.id,
      type: 'find_me',
      state: 'ended',
      config: {
        tickIntervalMs: 10_000,
        pairTimeoutMs: 180_000,
        bumpWindowMs: 1_200,
        minBumpMagnitude: 8,
        allowManualConfirm: true,
        manualConfirmWindowMs: 10_000,
        manualConfirmHintAfterMs: 20_000,
      },
    })
    .returning()

  const people = await db
    .insert(participants)
    .values(
      ['Anna', 'Ben'].map((displayName) => ({
        eventId: event!.id,
        displayName,
        photoKey: `test/${randomUUID()}.webp`,
        profile: { company: 'Beispiel GmbH', role: 'Gründerin' },
        sessionTokenHash: hashToken(createSessionToken()),
        state: 'waiting' as const,
        ...(extra.lastSeenAt ? { lastSeenAt: extra.lastSeenAt, createdAt: extra.lastSeenAt } : {}),
      })),
    )
    .returning()

  await db.insert(pairs).values({
    gameId: game!.id,
    eventId: event!.id,
    aId: people[0]!.id,
    bId: people[1]!.id,
    state: 'confirmed',
    via: 'bump',
    expiresAt: new Date(),
    confirmedAt: new Date(),
    ...(extra.lastSeenAt ? { createdAt: extra.lastSeenAt } : {}),
  })

  return { eventId: event!.id, peopleIds: people.map((person) => person.id) }
}

describe('purgeExpiredEvents', () => {
  it('löscht Personendaten, lässt die Auswertung aber stehen', async () => {
    const gestern = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const { eventId, peopleIds } = await seedEvent(gestern)

    const result = await purgeExpiredEvents(db, log)
    expect(result.events).toBeGreaterThanOrEqual(1)

    const rows = await db.select().from(participants).where(inArray(participants.id, peopleIds))
    for (const row of rows) {
      expect(row.displayName).toBe('Teilnehmer')
      expect(row.photoKey).toBeNull()
      expect(row.profile).toEqual({})
      expect(row.deletedAt).not.toBeNull()
    }

    // Die Begegnung selbst bleibt — sonst sänke die Auswertung nachträglich auf null.
    const remaining = await db.select().from(pairs).where(eq(pairs.eventId, eventId))
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.state).toBe('confirmed')

    const [event] = await db.select().from(events).where(eq(events.id, eventId))
    expect(event?.purgedAt).not.toBeNull()
  }, 30_000)

  it('fasst ein Event, das noch nicht vorbei ist, nicht an', async () => {
    const morgen = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const { eventId, peopleIds } = await seedEvent(morgen)

    await purgeExpiredEvents(db, log)

    const rows = await db.select().from(participants).where(inArray(participants.id, peopleIds))
    expect(rows.map((row) => row.displayName).sort()).toEqual(['Anna', 'Ben'])
    expect(rows.every((row) => row.photoKey !== null)).toBe(true)

    const [event] = await db.select().from(events).where(eq(events.id, eventId))
    expect(event?.purgedAt).toBeNull()
  }, 30_000)

  it('fasst ein Event ohne Enddatum nicht an, solange es lebt', async () => {
    // Ohne Enddatum ist unklar, wann die Frist beginnt — solange jemand aktiv ist,
    // im Zweifel nichts löschen.
    const { peopleIds } = await seedEvent(null)

    await purgeExpiredEvents(db, log)

    const rows = await db.select().from(participants).where(inArray(participants.id, peopleIds))
    expect(rows.every((row) => row.photoKey !== null)).toBe(true)
  }, 30_000)

  it('räumt ein archiviertes Event nach Ablauf der Frist auf — auch ohne Enddatum', async () => {
    // Archivieren ist der verlässliche Weg, die Frist zu starten: Die Admin-App legt
    // Events oft ohne Datum an, und die dürfen nicht für immer liegen bleiben.
    const vorgestern = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const { eventId, peopleIds } = await seedEvent(null, { archivedAt: vorgestern })

    await purgeExpiredEvents(db, log)

    const rows = await db.select().from(participants).where(inArray(participants.id, peopleIds))
    expect(rows.every((row) => row.photoKey === null && row.deletedAt !== null)).toBe(true)
    const [event] = await db.select().from(events).where(eq(events.id, eventId))
    expect(event?.purgedAt).not.toBeNull()
  }, 30_000)

  it('lässt ein gerade erst archiviertes Event in Ruhe', async () => {
    const { peopleIds } = await seedEvent(null, { archivedAt: new Date() })

    await purgeExpiredEvents(db, log)

    const rows = await db.select().from(participants).where(inArray(participants.id, peopleIds))
    expect(rows.every((row) => row.photoKey !== null)).toBe(true)
  }, 30_000)

  it('räumt ein Event ohne Datum und Archiv nach drei Tagen Stille auf', async () => {
    // Die Rückfallebene für vergessene Events: Wenn seit Tagen niemand mehr da war,
    // ist das Event vorbei — mit oder ohne Eintrag des Admins.
    const vorVierTagen = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    const { peopleIds } = await seedEvent(null, {
      createdAt: vorVierTagen,
      lastSeenAt: vorVierTagen,
    })

    await purgeExpiredEvents(db, log)

    const rows = await db.select().from(participants).where(inArray(participants.id, peopleIds))
    expect(rows.every((row) => row.photoKey === null)).toBe(true)
  }, 30_000)

  it('räumt ein bereinigtes Event erneut auf, wenn danach jemand beitritt', async () => {
    // `purgedAt` ist keine Sperre: Wer einem reaktivierten, aber abgelaufenen Event
    // beitritt, wird beim nächsten Lauf genauso bereinigt wie alle davor.
    const gestern = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const { eventId } = await seedEvent(gestern)
    await purgeExpiredEvents(db, log)

    const [late] = await db
      .insert(participants)
      .values({
        eventId,
        displayName: 'Carla',
        photoKey: `test/${randomUUID()}.webp`,
        sessionTokenHash: hashToken(createSessionToken()),
        state: 'waiting',
      })
      .returning()

    await purgeExpiredEvents(db, log)

    const [row] = await db.select().from(participants).where(eq(participants.id, late!.id))
    expect(row?.photoKey).toBeNull()
    expect(row?.deletedAt).not.toBeNull()
  }, 30_000)

  it('räumt nicht zweimal auf', async () => {
    const gestern = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await seedEvent(gestern)

    const first = await purgeExpiredEvents(db, log)
    const second = await purgeExpiredEvents(db, log)

    expect(first.events).toBeGreaterThanOrEqual(1)
    expect(second.events).toBe(0)
  }, 30_000)

  it('lässt die Zahl der Begegnungen unverändert', async () => {
    const gestern = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const { eventId } = await seedEvent(gestern)

    const confirmedTotal = async (): Promise<number> => {
      const runs = await computeGameRunStats(db, eventId)
      return [...runs.values()].reduce((sum, run) => sum + run.matchesConfirmed, 0)
    }

    const vorher = await confirmedTotal()
    await purgeExpiredEvents(db, log)
    const nachher = await confirmedTotal()

    expect(vorher).toBe(1)
    expect(nachher).toBe(1)
  }, 30_000)
})
