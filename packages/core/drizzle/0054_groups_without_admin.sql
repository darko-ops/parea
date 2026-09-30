-- Every group with people in it has somebody who can run it (security review
-- L13): renaming and the group picture are admin-only now, so a group left
-- with no admin — made before roles, or before `ensureAdmin` — could never be
-- renamed again. The same rule as succession: the longest-standing member.
UPDATE "group_member" gm SET "role" = 'admin'
FROM (
  SELECT DISTINCT ON (g."group_id") g."group_id", g."actor_id"
  FROM "group_member" g
  WHERE NOT EXISTS (
    SELECT 1 FROM "group_member" a WHERE a."group_id" = g."group_id" AND a."role" = 'admin'
  )
  ORDER BY g."group_id", g."joined_at" ASC
) heir
WHERE gm."group_id" = heir."group_id" AND gm."actor_id" = heir."actor_id";
