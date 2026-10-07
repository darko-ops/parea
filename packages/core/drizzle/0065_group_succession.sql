-- A group whose last admin left, before leaving handed it on (or because the
-- hand-off failed after the leave had already been written), goes to the same
-- heir `crownGroups` in apps/web/src/succession.ts would choose: somebody not
-- suspended where anybody else is there, then whoever has added the most live
-- photos across the group's rolls, then whoever joined first. Kept in step
-- with `crownGroups` by apps/web/test/succession.test.ts.
UPDATE "group_member" gm SET "role" = 'admin'
FROM (
  SELECT DISTINCT ON (g."group_id") g."group_id", g."actor_id"
  FROM "group_member" g
  WHERE NOT EXISTS (
    SELECT 1 FROM "group_member" a WHERE a."group_id" = g."group_id" AND a."role" = 'admin'
  )
  ORDER BY
    g."group_id",
    EXISTS (SELECT 1 FROM "suspension" s WHERE s."actor_id" = g."actor_id" AND s."lifted_at" IS NULL) ASC,
    (
      SELECT count(*) FROM "photo" p
      JOIN "event" e ON e."id" = p."event_id"
      WHERE e."group_id" = g."group_id" AND e."deleted_at" IS NULL
        AND p."uploader_id" = g."actor_id" AND p."deleted_at" IS NULL AND p."status" = 'ready'
    ) DESC,
    g."joined_at" ASC
) heir
WHERE gm."group_id" = heir."group_id" AND gm."actor_id" = heir."actor_id";
