-- Parea's own account gives back the phone number that was verified onto it.
--
-- It was a person's number, verified while signed in as Parea, and a number
-- belongs to one actor at a time (`phone_hash` is unique) — so while Parea held
-- it, its owner could not add it to their own account, and anybody looking it
-- up found the product instead of them. The same three columns `DELETE
-- /api/account/phone` clears, plus any code still waiting to be confirmed, so a
-- verification in flight cannot put it back.
UPDATE "actor"
SET "phone_hash" = NULL, "phone_last2" = NULL, "phone_verified_at" = NULL
WHERE "id" = '00000000-0000-4000-8000-000000000002';
--> statement-breakpoint
DELETE FROM "phone_code" WHERE "actor_id" = '00000000-0000-4000-8000-000000000002';
