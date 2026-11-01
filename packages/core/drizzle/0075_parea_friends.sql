-- Parea is a friend of every account that exists, both rows of each pair.
--
-- New accounts are befriended at sign-in (`signIn` in apps/web/src/accounts.ts);
-- this is everybody who signed up before that. A friend in name only: the
-- queries that grant something for a friendship — moments, adding somebody to
-- a chat without asking, mutual friends in suggestions — leave this actor out.
--
-- Skips guests, merged actors and anybody a block stands between, and
-- `ON CONFLICT DO NOTHING` makes it safe to re-run and a no-op on a database
-- without the Parea actor (0037 inserts nothing there, so the join is empty).
INSERT INTO "friendship" ("actor_id", "friend_actor_id")
SELECT pair.actor_id, pair.friend_actor_id
FROM "actor" a
JOIN "actor" p ON p."id" = '00000000-0000-4000-8000-000000000002'
CROSS JOIN LATERAL (
  VALUES (a."id", p."id"), (p."id", a."id")
) AS pair(actor_id, friend_actor_id)
WHERE a."id" <> p."id"
  AND a."account_id" IS NOT NULL
  AND a."merged_into_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "block" b
    WHERE (b."blocker_actor_id" = a."id" AND b."blocked_actor_id" = p."id")
       OR (b."blocker_actor_id" = p."id" AND b."blocked_actor_id" = a."id")
  )
ON CONFLICT DO NOTHING;
