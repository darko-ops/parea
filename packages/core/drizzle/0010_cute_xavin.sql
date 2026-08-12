CREATE TABLE "moderation_flag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"labels" text NOT NULL,
	"score" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "moderation_flag" ADD CONSTRAINT "moderation_flag_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_flag" ADD CONSTRAINT "moderation_flag_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_flag" ADD CONSTRAINT "moderation_flag_resolved_by_actor_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_flag_open_idx" ON "moderation_flag" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "moderation_flag_photo_idx" ON "moderation_flag" USING btree ("photo_id");