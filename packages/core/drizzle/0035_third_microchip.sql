CREATE TABLE "photo_favourite" (
	"photo_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_favourite_photo_id_actor_id_pk" PRIMARY KEY("photo_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "photo_favourite" ADD CONSTRAINT "photo_favourite_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_favourite" ADD CONSTRAINT "photo_favourite_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_favourite_actor_idx" ON "photo_favourite" USING btree ("actor_id");