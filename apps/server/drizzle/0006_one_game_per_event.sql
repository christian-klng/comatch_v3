-- Ein Event, ein Spiel: Bisherige Spielläufe eines Events werden zu einem
-- zusammengeführt, beendete Spiele gelten fortan als pausiert. Zuerst die alten
-- Indizes weg — der partielle hängt am Enum, das gleich neu entsteht.
DROP INDEX "games_one_active_per_event";--> statement-breakpoint
DROP INDEX "games_event_idx";--> statement-breakpoint
-- Es bleibt das laufende oder pausierte Spiel, sonst das älteste. Die Paare der
-- anderen Läufe wandern dorthin, damit Auswertung und Matcher-Historie erhalten bleiben.
CREATE TEMP TABLE "game_keepers" AS
  SELECT DISTINCT ON ("event_id") "id", "event_id"
  FROM "games"
  ORDER BY "event_id", ("state" IN ('running', 'paused')) DESC, "created_at";--> statement-breakpoint
UPDATE "pairs" SET "game_id" = k."id"
  FROM "game_keepers" k
  WHERE "pairs"."event_id" = k."event_id" AND "pairs"."game_id" <> k."id";--> statement-breakpoint
UPDATE "games" SET "started_at" = (
    SELECT min(x."started_at") FROM "games" x WHERE x."event_id" = "games"."event_id"
  )
  WHERE "id" IN (SELECT "id" FROM "game_keepers");--> statement-breakpoint
DELETE FROM "games" WHERE "id" NOT IN (SELECT "id" FROM "game_keepers");--> statement-breakpoint
DROP TABLE "game_keepers";--> statement-breakpoint
UPDATE "games" SET "state" = 'paused' WHERE "state" = 'ended';--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "state" SET DEFAULT 'idle'::text;--> statement-breakpoint
DROP TYPE "public"."game_state";--> statement-breakpoint
CREATE TYPE "public"."game_state" AS ENUM('idle', 'running', 'paused');--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "state" SET DEFAULT 'idle'::"public"."game_state";--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "state" SET DATA TYPE "public"."game_state" USING "state"::"public"."game_state";--> statement-breakpoint
CREATE UNIQUE INDEX "games_event_idx" ON "games" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "ended_at";--> statement-breakpoint
DROP TYPE "public"."game_type";
