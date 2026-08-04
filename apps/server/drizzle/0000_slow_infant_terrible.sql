CREATE TYPE "public"."game_state" AS ENUM('idle', 'running', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."game_type" AS ENUM('find_me');--> statement-breakpoint
CREATE TYPE "public"."pair_end_reason" AS ENUM('expired', 'cancelled', 'partner_left', 'game_stopped');--> statement-breakpoint
CREATE TYPE "public"."pair_state" AS ENUM('pending', 'confirmed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."participant_state" AS ENUM('onboarding', 'waiting', 'searching', 'matched', 'idle', 'offline');--> statement-breakpoint
CREATE TYPE "public"."signal_kind" AS ENUM('bump', 'manual');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"type" "game_type" NOT NULL,
	"state" "game_state" DEFAULT 'idle' NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"state" "pair_state" DEFAULT 'pending' NOT NULL,
	"via" "signal_kind",
	"end_reason" "pair_end_reason",
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"photo_key" text,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "participant_state" DEFAULT 'onboarding' NOT NULL,
	"session_token_hash" text NOT NULL,
	"bump_threshold" real,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"kind" "signal_kind" NOT NULL,
	"t" bigint NOT NULL,
	"magnitude" real,
	"matched" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_a_id_participants_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_b_id_participants_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_ends_at_idx" ON "events" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "games_one_active_per_event" ON "games" USING btree ("event_id") WHERE "games"."state" in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "games_event_idx" ON "games" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "pairs_game_state_idx" ON "pairs" USING btree ("game_id","state");--> statement-breakpoint
CREATE INDEX "pairs_event_a_idx" ON "pairs" USING btree ("event_id","a_id");--> statement-breakpoint
CREATE INDEX "pairs_event_b_idx" ON "pairs" USING btree ("event_id","b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_session_token_idx" ON "participants" USING btree ("session_token_hash");--> statement-breakpoint
CREATE INDEX "participants_event_state_idx" ON "participants" USING btree ("event_id","state");--> statement-breakpoint
CREATE INDEX "signals_pair_idx" ON "signals" USING btree ("pair_id","t");