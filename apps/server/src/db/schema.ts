import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  GAME_STATES,
  GAME_TYPES,
  PAIR_END_REASONS,
  PAIR_STATES,
  PARTICIPANT_STATES,
  SIGNAL_KINDS,
  type FindMeConfig,
  type ParticipantProfile,
} from '@comatch/core'

/*
 * Die Enum-Werte kommen aus @comatch/core, damit Datenbank und TypeScript nicht
 * auseinanderlaufen können: Ein neuer Zustand im Core erzwingt hier eine Migration.
 */
export const gameTypeEnum = pgEnum('game_type', GAME_TYPES)
export const gameStateEnum = pgEnum('game_state', GAME_STATES)
export const pairStateEnum = pgEnum('pair_state', PAIR_STATES)
export const pairEndReasonEnum = pgEnum('pair_end_reason', PAIR_END_REASONS)
export const participantStateEnum = pgEnum('participant_state', PARTICIPANT_STATES)
export const signalKindEnum = pgEnum('signal_kind', SIGNAL_KINDS)

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
    /** Gesetzt, sobald der Aufräumjob Fotos und Klarnamen entfernt hat. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    /** Gesetzt, wenn ein Admin das Event archiviert hat. Unabhängig von purgedAt. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_ends_at_idx').on(t.endsAt)],
)

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    type: gameTypeEnum('type').notNull(),
    state: gameStateEnum('state').notNull().default('idle'),
    config: jsonb('config').$type<FindMeConfig>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * „Nur ein Spiel zur Zeit" ist eine Zusage an den Admin — deshalb steht sie als
     * Constraint in der Datenbank und nicht bloß als Prüfung im Anwendungscode.
     * Ein pausiertes Spiel belegt den Platz weiterhin: Es ist nicht beendet.
     */
    uniqueIndex('games_one_active_per_event')
      .on(t.eventId)
      .where(sql`${t.state} in ('running', 'paused')`),
    index('games_event_idx').on(t.eventId),
  ],
)

export const participants = pgTable(
  'participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** Schlüssel im Objektspeicher, keine URL — ausgeliefert wird über kurzlebige Presigned URLs. */
    photoKey: text('photo_key'),
    profile: jsonb('profile').$type<ParticipantProfile>().notNull().default({}),
    state: participantStateEnum('state').notNull().default('onboarding'),
    /*
     * Nur der SHA-256 des Session-Tokens. Wer die Datenbank in die Hände bekommt,
     * kann sich damit nicht als Teilnehmer ausgeben.
     */
    sessionTokenHash: text('session_token_hash').notNull(),
    /** Kalibrierte Bump-Schwelle dieses Geräts — für die Auswertung der Trefferquote. */
    bumpThreshold: real('bump_threshold'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Selbst gelöschter Zugang: Personendaten sind weg, die Match-Zahlen bleiben. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('participants_session_token_idx').on(t.sessionTokenHash),
    index('participants_event_state_idx').on(t.eventId, t.state),
  ],
)

export const pairs = pgTable(
  'pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    /*
     * Denormalisiert aus games. Der Matcher fragt bei jedem Takt „wen hatten diese
     * beiden schon?" über das ganze Event hinweg ab — ein zusätzlicher Join zu games
     * wäre auf dem heißesten Pfad der App.
     */
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    aId: uuid('a_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    bId: uuid('b_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    state: pairStateEnum('state').notNull().default('pending'),
    /** Wodurch der Match zustande kam — misst, wie gut die Bump-Erkennung trägt. */
    via: signalKindEnum('via'),
    endReason: pairEndReasonEnum('end_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pairs_game_state_idx').on(t.gameId, t.state),
    index('pairs_event_a_idx').on(t.eventId, t.aId),
    index('pairs_event_b_idx').on(t.eventId, t.bId),
  ],
)

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pairId: uuid('pair_id')
      .notNull()
      .references(() => pairs.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    kind: signalKindEnum('kind').notNull(),
    /** Zeitpunkt auf dem Gerät, in Serverzeit umgerechnet (ms seit Epoche). */
    t: bigint('t', { mode: 'number' }).notNull(),
    magnitude: real('magnitude'),
    /** Hat dieses Signal den Match ausgelöst? Trennt Treffer von Fehlversuchen. */
    matched: boolean('matched').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signals_pair_idx').on(t.pairId, t.t)],
)

export type AdminRow = typeof admins.$inferSelect
export type EventRow = typeof events.$inferSelect
export type GameRow = typeof games.$inferSelect
export type ParticipantRow = typeof participants.$inferSelect
export type PairRow = typeof pairs.$inferSelect
export type SignalRow = typeof signals.$inferSelect
