-- A participant can be in a roll by right — the "let in by name" an accepted
-- invitation or an approved request already means — which is what a group's
-- people keep when a roll is taken out of its group. See `admitted` on
-- `event_participant`.
ALTER TABLE "event_participant" ADD COLUMN "admitted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Everybody who has already added to a roll in a group, so leaving the group
-- does not shut them out of the roll they added to — what an upload to a roll
-- in a group writes from now on.
UPDATE "event_participant" p SET "admitted" = true
FROM "event" e
WHERE e."id" = p."event_id"
  AND e."group_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "photo" ph
    WHERE ph."event_id" = p."event_id" AND ph."uploader_id" = p."actor_id"
  );
