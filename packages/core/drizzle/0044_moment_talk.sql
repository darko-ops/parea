-- Comments and reactions on moments: their own tables, hanging from the
-- moment and going with it when it expires or is taken back.
CREATE TABLE "moment_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moment_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moment_reaction" (
	"moment_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moment_reaction_moment_id_actor_id_emoji_pk" PRIMARY KEY("moment_id","actor_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "moment_comment" ADD CONSTRAINT "moment_comment_moment_id_moment_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_comment" ADD CONSTRAINT "moment_comment_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_reaction" ADD CONSTRAINT "moment_reaction_moment_id_moment_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_reaction" ADD CONSTRAINT "moment_reaction_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moment_comment_moment_idx" ON "moment_comment" USING btree ("moment_id","created_at");