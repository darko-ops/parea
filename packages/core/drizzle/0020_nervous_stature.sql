CREATE TABLE "hidden_activity" (
	"actor_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_activity_actor_id_item_key_pk" PRIMARY KEY("actor_id","item_key")
);
--> statement-breakpoint
ALTER TABLE "hidden_activity" ADD CONSTRAINT "hidden_activity_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- The key is composed by the feed from ids, an emoji and a timestamp, so it
-- has a shape and a ceiling. Bounded in the column as well as at the route:
-- the route is the only door today, and a check constraint stays true if a
-- second one is ever added.
ALTER TABLE "hidden_activity" ADD CONSTRAINT "hidden_activity_key_len"
  CHECK (length("item_key") BETWEEN 1 AND 200);
