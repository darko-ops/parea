ALTER TABLE "event" ADD COLUMN "contribute_policy" text DEFAULT 'everyone' NOT NULL;
--> statement-breakpoint
-- The setting this replaces, carried across rather than defaulted.
--
-- `uploads_open` said two of the three things this column says, and said them
-- as a boolean: open meant "whoever the album is open to" and closed meant
-- "nobody at all". The third — the host puts the photographs in and everybody
-- else looks — could not be said, which is the reason for the change.
--
-- Without this every album in the database would quietly reopen to its
-- viewers on deploy, including the ones somebody had deliberately closed. A
-- generated drop-and-add does exactly that and says nothing about it.
UPDATE "event"
   SET "contribute_policy" = CASE WHEN "uploads_open" THEN 'everyone' ELSE 'nobody' END;
