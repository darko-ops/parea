CREATE TABLE "event_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"invited_by_actor_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "event_invite" ADD CONSTRAINT "event_invite_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invite" ADD CONSTRAINT "event_invite_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invite" ADD CONSTRAINT "event_invite_invited_by_actor_id_actor_id_fk" FOREIGN KEY ("invited_by_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_invite_pair_idx" ON "event_invite" USING btree ("event_id","actor_id");--> statement-breakpoint
CREATE INDEX "event_invite_inbox_idx" ON "event_invite" USING btree ("actor_id","status");