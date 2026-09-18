CREATE TABLE "photo_tag" (
	"photo_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"tagged_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_tag_photo_id_actor_id_pk" PRIMARY KEY("photo_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "photo_tag" ADD CONSTRAINT "photo_tag_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_tag" ADD CONSTRAINT "photo_tag_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_tag" ADD CONSTRAINT "photo_tag_tagged_by_actor_id_fk" FOREIGN KEY ("tagged_by") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_tag_actor_idx" ON "photo_tag" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "photo_tag_by_idx" ON "photo_tag" USING btree ("tagged_by");