CREATE TABLE "safety_incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid,
	"event_id" uuid NOT NULL,
	"uploader_actor_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"classification" text NOT NULL,
	"provider_reference" text,
	"storage_key" text NOT NULL,
	"content_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_at" timestamp with time zone,
	"report_reference" text,
	"preservation_ends_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "safety_incident" ADD CONSTRAINT "safety_incident_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_incident_open_idx" ON "safety_incident" USING btree ("reported_at","created_at");--> statement-breakpoint
CREATE INDEX "safety_incident_photo_idx" ON "safety_incident" USING btree ("photo_id");