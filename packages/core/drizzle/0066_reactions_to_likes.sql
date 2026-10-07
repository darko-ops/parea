-- Reactions become likes. Every reaction anybody left, whatever its emoji, is
-- now a like from that person, and somebody who left several on one thing
-- counts once: their heart if they left one, else their earliest reaction, is
-- kept and redrawn as a heart, and the rest are deleted. The tables and their
-- `emoji` column stay as they were; `LIKE` in apps/web/src/reactions.ts is the
-- one value written from now on. Checked by apps/web/test/likes.test.ts.
DELETE FROM "photo_reaction" r
WHERE r."emoji" <> '❤️' AND EXISTS (
  SELECT 1 FROM "photo_reaction" k
  WHERE k."photo_id" = r."photo_id" AND k."actor_id" = r."actor_id"
    AND (k."emoji" = '❤️' OR (k."emoji" <> '❤️' AND (k."created_at", k."emoji") < (r."created_at", r."emoji")))
);
--> statement-breakpoint
UPDATE "photo_reaction" SET "emoji" = '❤️' WHERE "emoji" <> '❤️';
--> statement-breakpoint
DELETE FROM "message_reaction" r
WHERE r."emoji" <> '❤️' AND EXISTS (
  SELECT 1 FROM "message_reaction" k
  WHERE k."message_id" = r."message_id" AND k."actor_id" = r."actor_id"
    AND (k."emoji" = '❤️' OR (k."emoji" <> '❤️' AND (k."created_at", k."emoji") < (r."created_at", r."emoji")))
);
--> statement-breakpoint
UPDATE "message_reaction" SET "emoji" = '❤️' WHERE "emoji" <> '❤️';
--> statement-breakpoint
DELETE FROM "group_message_reaction" r
WHERE r."emoji" <> '❤️' AND EXISTS (
  SELECT 1 FROM "group_message_reaction" k
  WHERE k."message_id" = r."message_id" AND k."actor_id" = r."actor_id"
    AND (k."emoji" = '❤️' OR (k."emoji" <> '❤️' AND (k."created_at", k."emoji") < (r."created_at", r."emoji")))
);
--> statement-breakpoint
UPDATE "group_message_reaction" SET "emoji" = '❤️' WHERE "emoji" <> '❤️';
--> statement-breakpoint
DELETE FROM "moment_reaction" r
WHERE r."emoji" <> '❤️' AND EXISTS (
  SELECT 1 FROM "moment_reaction" k
  WHERE k."moment_id" = r."moment_id" AND k."actor_id" = r."actor_id"
    AND (k."emoji" = '❤️' OR (k."emoji" <> '❤️' AND (k."created_at", k."emoji") < (r."created_at", r."emoji")))
);
--> statement-breakpoint
UPDATE "moment_reaction" SET "emoji" = '❤️' WHERE "emoji" <> '❤️';
