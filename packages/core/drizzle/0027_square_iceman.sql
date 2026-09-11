CREATE TABLE "photo_reaction" (
	"photo_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_reaction_photo_id_actor_id_emoji_pk" PRIMARY KEY("photo_id","actor_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "photo_reaction" ADD CONSTRAINT "photo_reaction_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_reaction" ADD CONSTRAINT "photo_reaction_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_reaction_actor_idx" ON "photo_reaction" USING btree ("actor_id");--> statement-breakpoint
-- The same bound `message_reaction` carries, and for the same reason: the
-- emoji is text rather than an enum because the offered set is a design
-- decision that will change, and a migration per emoji is a migration nobody
-- will want to write. 32 bytes is generous for a grapheme cluster and far too
-- small to smuggle a message into.
ALTER TABLE "photo_reaction" ADD CONSTRAINT "photo_reaction_emoji_len"
  CHECK (length("emoji") BETWEEN 1 AND 32);
