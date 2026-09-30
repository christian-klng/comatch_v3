ALTER TYPE "public"."signal_kind" ADD VALUE 'code';--> statement-breakpoint
ALTER TABLE "pairs" ADD COLUMN "code_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "pairs" ADD COLUMN "code_choices" text[];--> statement-breakpoint
ALTER TABLE "pairs" ADD COLUMN "code_misses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "confirm_code" text;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_code_requested_by_participants_id_fk" FOREIGN KEY ("code_requested_by") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_event_confirm_code_idx" ON "participants" USING btree ("event_id","confirm_code");--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_code_request_complete" CHECK (("pairs"."code_requested_by" is null) = ("pairs"."code_choices" is null));