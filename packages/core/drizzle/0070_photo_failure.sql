ALTER TABLE "photo" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "failure_reason" text;--> statement-breakpoint
CREATE INDEX "photo_failed_idx" ON "photo" USING btree ("failed_at") WHERE "photo"."failed_at" is not null;