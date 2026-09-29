-- The order photographs were added to a roll, so a roll can be drawn as a
-- stack: the newest addition on top, and within one the first pick lowest.
ALTER TABLE "photo" ADD COLUMN "added_seq" bigserial NOT NULL;--> statement-breakpoint
-- Photos already here were added before anyone recorded the order they were
-- picked in. Upload time says which addition came first; within one (the same
-- person in the same minute) the order they were taken in stands in for the
-- order they were picked in, which is what a camera roll shows anyway.
UPDATE "photo" AS p SET "added_seq" = o.n
FROM (
  SELECT "id", row_number() OVER (
    ORDER BY date_trunc('minute', "uploaded_at"), "uploader_id",
             coalesce("captured_at", "uploaded_at"), "uploaded_at", "id"
  ) AS n
  FROM "photo"
) AS o
WHERE p."id" = o."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('"photo"', 'added_seq'), coalesce((SELECT max("added_seq") FROM "photo"), 0) + 1, false);--> statement-breakpoint
CREATE INDEX "photo_event_added_idx" ON "photo" USING btree ("event_id","added_seq");
