ALTER TABLE "group_member" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_member" ADD COLUMN "cleared_at" timestamp with time zone;