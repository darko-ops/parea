-- Moments become one stream: a small copy of each for the strip on Home,
-- and a row per moment somebody has opened, so the ones they have not seen
-- come first.
CREATE TABLE "moment_view" (
	"actor_id" uuid NOT NULL,
	"moment_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moment_view_actor_id_moment_id_pk" PRIMARY KEY("actor_id","moment_id")
);
--> statement-breakpoint
ALTER TABLE "moment" ADD COLUMN "thumb_key" text;--> statement-breakpoint
ALTER TABLE "moment_view" ADD CONSTRAINT "moment_view_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_view" ADD CONSTRAINT "moment_view_moment_id_moment_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moment"("id") ON DELETE cascade ON UPDATE no action;