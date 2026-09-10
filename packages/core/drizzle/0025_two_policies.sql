-- Three access policies become two: public and private.
--
-- `link_open` was already "anyone can see it", so it becomes `public`.
-- Everything else becomes `private`, which is the fail-closed direction and
-- the one that matches what people chose the old settings for:
--
--   account_required  the link admitted whoever signed in. Nobody who picked
--                     it was asking for a forwarded link to work, so they get
--                     the stronger of the two rather than the open one.
--   request_access    already exactly what `private` now means.
--
-- Written as an else-branch rather than a list of values on purpose: a row
-- holding some third string that predates this file must not survive as one
-- `authorize` would reject, and a rejected policy is an album nobody can open
-- including the person who made it.
ALTER TABLE "event" ALTER COLUMN "access_policy" SET DEFAULT 'public';--> statement-breakpoint
UPDATE "event"
   SET "access_policy" = CASE WHEN "access_policy" = 'link_open' THEN 'public' ELSE 'private' END
 WHERE "access_policy" NOT IN ('public', 'private');
