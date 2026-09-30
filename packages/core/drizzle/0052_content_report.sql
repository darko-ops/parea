CREATE TABLE "content_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"subject_actor_id" uuid,
	"reporter_actor_id" uuid,
	"kind" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_subject_actor_id_actor_id_fk" FOREIGN KEY ("subject_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_reporter_actor_id_actor_id_fk" FOREIGN KEY ("reporter_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_report_open_idx" ON "content_report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "content_report_target_idx" ON "content_report" USING btree ("target_kind","target_id");