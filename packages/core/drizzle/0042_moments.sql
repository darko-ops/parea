-- Moments: one photograph somebody puts in front of their people.
--
-- Not an event photo and not in an event. Stored like a profile picture —
-- re-encoded on arrival, one rendition — and soft-deleted so taking one back
-- is immediate for everyone reading it.
CREATE TABLE "moment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "moment" ADD CONSTRAINT "moment_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moment_actor_created_idx" ON "moment" USING btree ("actor_id","created_at");