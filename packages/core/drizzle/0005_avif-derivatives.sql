-- Statement order corrected by hand: drizzle-kit emitted the primary-key
-- change before the column it names, which fails on an empty database as
-- readily as a full one.
ALTER TABLE "derivative" ADD COLUMN "format" text DEFAULT 'jpeg' NOT NULL;--> statement-breakpoint
ALTER TABLE "derivative" DROP CONSTRAINT "derivative_photo_id_kind_pk";--> statement-breakpoint
ALTER TABLE "derivative" ADD CONSTRAINT "derivative_photo_id_kind_format_pk" PRIMARY KEY("photo_id","kind","format");
