CREATE TABLE "event_access_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "event_access_request" ADD CONSTRAINT "event_access_request_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_access_request" ADD CONSTRAINT "event_access_request_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_access_request" ADD CONSTRAINT "event_access_request_resolved_by_actor_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_access_request_actor_idx" ON "event_access_request" USING btree ("event_id","actor_id");--> statement-breakpoint
CREATE INDEX "event_access_request_open_idx" ON "event_access_request" USING btree ("event_id","status");