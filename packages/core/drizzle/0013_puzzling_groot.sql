DROP INDEX "actor_handle_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "actor_handle_idx" ON "actor" USING btree (lower("handle"));