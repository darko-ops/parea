CREATE TABLE "event_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"author_actor_id" uuid NOT NULL,
	"photo_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_reaction" (
	"message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reaction_message_id_actor_id_emoji_pk" PRIMARY KEY("message_id","actor_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "event_message" ADD CONSTRAINT "event_message_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_message" ADD CONSTRAINT "event_message_author_actor_id_actor_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_message" ADD CONSTRAINT "event_message_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_message_id_event_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."event_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_message_thread_idx" ON "event_message" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "event_message_photo_idx" ON "event_message" USING btree ("photo_id");--> statement-breakpoint
-- Upper bounds only, and in the database rather than only in the route.
--
-- The size is a storage fact and belongs here; "not empty" is a meaning fact
-- and belongs in the API, because a deleted message is legitimately empty —
-- deletion overwrites the body rather than keeping it around behind a flag,
-- so a NOT-empty check here would make deleting impossible.
--
-- The emoji is text rather than an enum on purpose: the offered set is a
-- design decision that will change, and a migration per emoji is a migration
-- nobody will want to write. 32 bytes is generous for a grapheme cluster
-- (a flag with a skin tone and a zero-width joiner runs to about 28) and far
-- too small to smuggle a message into.
ALTER TABLE "event_message" ADD CONSTRAINT "event_message_body_len"
  CHECK (length("body") <= 2000);--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_emoji_len"
  CHECK (length("emoji") BETWEEN 1 AND 32);
