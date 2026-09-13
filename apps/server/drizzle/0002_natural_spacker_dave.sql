CREATE TYPE "public"."locale" AS ENUM('de', 'en');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "locale" "locale" DEFAULT 'de' NOT NULL;