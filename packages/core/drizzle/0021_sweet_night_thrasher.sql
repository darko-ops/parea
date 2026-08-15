ALTER TABLE "actor" ADD COLUMN "phone_hash" text;--> statement-breakpoint
ALTER TABLE "actor" ADD COLUMN "phone_last2" text;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_phone_hash_unique" UNIQUE("phone_hash");