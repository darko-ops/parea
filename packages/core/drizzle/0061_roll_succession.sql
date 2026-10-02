-- A roll whose Host closed their account goes to whoever added the most to it
-- (apps/web/src/succession.ts, `passOnRolls`). Before that rule, closing an
-- account left every roll they made with nobody able to rename, open, close or
-- let anybody into it. Making a roll has always needed an account, so a Host
-- without one is somebody who closed theirs. Kept in step with `passOnRolls` by
-- apps/web/test/succession.test.ts.
WITH heir AS (
  SELECT DISTINCT ON (e."id") e."id" AS event_id, ep."actor_id"
  FROM "event" e
  JOIN "actor" host ON host."id" = e."created_by" AND host."account_id" IS NULL
  JOIN "event_participant" ep ON ep."event_id" = e."id" AND ep."actor_id" <> e."created_by"
  JOIN "actor" a ON a."id" = ep."actor_id" AND a."account_id" IS NOT NULL
  WHERE e."deleted_at" IS NULL
  ORDER BY
    e."id",
    EXISTS (SELECT 1 FROM "suspension" s WHERE s."actor_id" = ep."actor_id" AND s."lifted_at" IS NULL) ASC,
    (SELECT count(*) FROM "photo" p
      WHERE p."event_id" = e."id" AND p."uploader_id" = ep."actor_id"
        AND p."deleted_at" IS NULL AND p."status" = 'ready') DESC,
    ep."first_seen_at" ASC
),
moved AS (
  UPDATE "event" SET "created_by" = heir."actor_id"
  FROM heir
  WHERE "event"."id" = heir.event_id
  RETURNING "event"."id", "event"."created_by"
)
UPDATE "event_participant" ep SET "role" = 'member'
FROM moved
WHERE ep."event_id" = moved."id" AND ep."actor_id" = moved."created_by";
