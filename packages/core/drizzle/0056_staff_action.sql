CREATE TABLE "staff_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff" text NOT NULL,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "staff_action_target_idx" ON "staff_action" USING btree ("target_kind","target_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_action_created_idx" ON "staff_action" USING btree ("created_at");