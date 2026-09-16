ALTER TABLE "event" ADD COLUMN "cover_photo_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "cover_x" real;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "cover_y" real;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "cover_zoom" real;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_cover_photo_id_photo_id_fk" FOREIGN KEY ("cover_photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;