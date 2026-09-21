CREATE TYPE "public"."logo_tone" AS ENUM('light', 'dark', 'mixed');--> statement-breakpoint
CREATE TABLE "design_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"design" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "design" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "logo_tone" "logo_tone";--> statement-breakpoint
ALTER TABLE "design_templates" ADD CONSTRAINT "design_templates_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_templates_name_idx" ON "design_templates" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_logo_complete" CHECK (("events"."logo_key" is null) = ("events"."logo_tone" is null));