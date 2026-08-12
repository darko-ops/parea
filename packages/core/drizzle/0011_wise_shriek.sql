CREATE TABLE "moderation_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "moderation_action_photo_idx" ON "moderation_action" USING btree ("photo_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_action_event_idx" ON "moderation_action" USING btree ("event_id","created_at");