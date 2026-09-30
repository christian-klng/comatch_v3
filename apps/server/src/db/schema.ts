import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  DEFAULT_EVENT_LOCALE,
  GAME_STATES,
  GAME_TYPES,
  LOCALES,
  LOGO_TONES,
  PAIR_END_REASONS,
  PAIR_STATES,
  PARTICIPANT_STATES,
  SIGNAL_KINDS,
  type EventDesign,
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
export const localeEnum = pgEnum('locale', LOCALES)
export const logoToneEnum = pgEnum('logo_tone', LOGO_TONES)

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
    /**
     * Sprache der Leinwand und Rückfallebene für Teilnehmende. Wessen Browser eine
     * unterstützte Sprache nennt, sieht diese — die Einstellung greift nur für den Rest.
     */
    locale: localeEnum('locale').notNull().default(DEFAULT_EVENT_LOCALE),
    /**
     * Nur die Eingaben des Admins, nie die daraus abgeleiteten Farben — die rechnet
     * `deriveTheme` bei jeder Anzeige neu. `null` ist das Comatch-Standarddesign.
     */
    design: jsonb('design').$type<EventDesign>(),
    /** Schlüssel im Objektspeicher. Anders als ein Foto ist das Logo öffentlich. */
    logoKey: text('logo_key'),
    /** Beim Upload gemessen: Daraus entscheidet die Oberfläche, ob das Logo eine Plakette braucht. */
    logoTone: logoToneEnum('logo_tone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_ends_at_idx').on(t.endsAt),
    // Ein Logo ohne gemessene Helligkeit ließe sich nicht sicher platzieren.
    check('events_logo_complete', sql`(${t.logoKey} is null) = (${t.logoTone} is null)`),
  ],
)

/**
 * Gespeicherte Designs zum Wiederverwenden. Ein Event bekommt beim Anwenden eine
 * **Kopie**, keinen Verweis: Wer eine Vorlage später ändert, färbt damit kein Event
 * um, dessen Leinwand schon steht.
 */
export const designTemplates = pgTable(
  'design_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    design: jsonb('design').$type<EventDesign>().notNull(),
    createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // „Messe" und „messe" wären in der Auswahlliste nicht zu unterscheiden.
  (t) => [uniqueIndex('design_templates_name_idx').on(sql`lower(${t.name})`)],
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
    /**
     * Aktivierungscode („Tango 47“), mit dem diese Person ein Treffen bestätigt. Gilt
     * für das ganze Event. Leer nur bei Zeilen von vor seiner Einführung — die
     * bekommen ihn, sobald sie ihn zum ersten Mal brauchen.
     */
    confirmCode: text('confirm_code'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Selbst gelöschter Zugang: Personendaten sind weg, die Match-Zahlen bleiben. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('participants_session_token_idx').on(t.sessionTokenHash),
    index('participants_event_state_idx').on(t.eventId, t.state),
    // Zwei gleiche Codes im Saal, und ein Fehlgriff sähe aus wie eine echte Begegnung.
    uniqueIndex('participants_event_confirm_code_idx').on(t.eventId, t.confirmCode),
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
    /** Wodurch der Match zustande kam — für die Auswertung nach dem Event. */
    via: signalKindEnum('via'),
    /** Wer „Wir haben uns gefunden“ getippt hat und nun seinen Code zeigt. */
    codeRequestedBy: uuid('code_requested_by').references(() => participants.id, {
      onDelete: 'cascade',
    }),
    /**
     * Die Vorschläge, aus denen das Gegenüber wählt. Gespeichert statt bei jeder
     * Anzeige neu gewürfelt: Nach einem Reconnect stünden sonst andere Codes zur
     * Wahl — und wer mehrmals neu lädt, könnte den richtigen herausfiltern.
     */
    codeChoices: text('code_choices').array(),
    /** Wie oft das Gegenüber daneben lag — sichtbar als Hinweis, gezählt in der Auswertung. */
    codeMisses: integer('code_misses').notNull().default(0),
    endReason: pairEndReasonEnum('end_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pairs_game_state_idx').on(t.gameId, t.state),
    index('pairs_event_a_idx').on(t.eventId, t.aId),
    index('pairs_event_b_idx').on(t.eventId, t.bId),
    // Eine Bestätigung ohne Vorschläge ließe das Gegenüber ratlos vor einem leeren Bildschirm.
    check(
      'pairs_code_request_complete',
      sql`(${t.codeRequestedBy} is null) = (${t.codeChoices} is null)`,
    ),
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
    /**
     * Zeitpunkt in Serverzeit (ms seit Epoche). Eine Codeauswahl stempelt der Server
     * selbst; ältere Bump-Signale trugen hier die umgerechnete Gerätezeit.
     */
    t: bigint('t', { mode: 'number' }).notNull(),
    /** Hat dieses Signal den Match ausgelöst? Bei einem Code: War er der richtige? */
    matched: boolean('matched').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signals_pair_idx').on(t.pairId, t.t)],
)

export type AdminRow = typeof admins.$inferSelect
export type EventRow = typeof events.$inferSelect
export type DesignTemplateRow = typeof designTemplates.$inferSelect
export type GameRow = typeof games.$inferSelect
export type ParticipantRow = typeof participants.$inferSelect
export type PairRow = typeof pairs.$inferSelect
export type SignalRow = typeof signals.$inferSelect
