CREATE TABLE "group_message_reaction" (
	"message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_message_reaction_message_id_actor_id_emoji_pk" PRIMARY KEY("message_id","actor_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "group_message_reaction" ADD CONSTRAINT "group_message_reaction_message_id_group_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."group_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_message_reaction" ADD CONSTRAINT "group_message_reaction_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_message_reaction_actor_idx" ON "group_message_reaction" USING btree ("actor_id");--> statement-breakpoint
-- The same bound `message_reaction` and `photo_reaction` carry, for the same
-- reason: the emoji is text rather than an enum because the offered set is a
-- design decision that will change, and a migration per emoji is a migration
-- nobody will want to write. 32 bytes is generous for one grapheme cluster
-- and far too small to smuggle a message into — which matters more now that
-- the set is open: the route asks "is this an emoji at all" rather than "is it
-- one of our six", so this check and `isEmoji` are the two locks on that door.
ALTER TABLE "group_message_reaction" ADD CONSTRAINT "group_message_reaction_emoji_len"
  CHECK (length("emoji") BETWEEN 1 AND 32);
