ALTER TABLE "safety_incident" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_incident" ADD COLUMN "subject" text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_incident" ADD COLUMN "subject_id" uuid;