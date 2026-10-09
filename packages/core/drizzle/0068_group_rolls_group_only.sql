-- A roll in a group is shared with exactly the group: Group only, which is
-- `private` with the group let in by `authorize`. Rolls in a group that were
-- open become Group only, and everybody already in one keeps it — the people
-- who came in by its link are let in by right first, since on a private roll
-- a link participant otherwise needs a capability in the browser they use.
UPDATE "event_participant" p SET "admitted" = true
FROM "event" e
WHERE e."id" = p."event_id"
  AND e."group_id" IS NOT NULL
  AND e."access_policy" = 'public';
--> statement-breakpoint
UPDATE "event" SET "access_policy" = 'private'
WHERE "group_id" IS NOT NULL AND "access_policy" = 'public';
