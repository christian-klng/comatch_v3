CREATE TABLE "explainer_steps" (
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"image_key" text,
	CONSTRAINT "explainer_steps_event_id_position_pk" PRIMARY KEY("event_id","position"),
	CONSTRAINT "explainer_steps_position" CHECK ("explainer_steps"."position" >= 0 and "explainer_steps"."position" < 3)
);
--> statement-breakpoint
ALTER TABLE "explainer_steps" ADD CONSTRAINT "explainer_steps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;