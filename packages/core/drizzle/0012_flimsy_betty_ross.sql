ALTER TABLE "actor" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "actor" ADD COLUMN "avatar_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "actor_handle_idx" ON "actor" USING btree ("handle");