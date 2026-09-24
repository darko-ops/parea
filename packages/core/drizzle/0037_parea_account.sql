-- Parea's own account.
--
-- Reference data rather than somebody's row: the product needs an identity it
-- can speak as, and the first thing it says is the welcome on an empty
-- Notifications page. A name and a picture invented at render time have
-- nothing behind them — no profile to open, no handle that resolves, and
-- nothing stopping a second spelling of it appearing somewhere else.
--
-- The ids are fixed rather than generated, which is the whole reason this is a
-- migration and not a script somebody remembers to run:
-- `apps/web/src/parea.ts` holds the same two, so the code can name this actor
-- without a lookup on every render, and a test compares the two files.
--
-- Deliberately a `user` actor with a handle and no avatar key. It is an
-- account like any other — which is the point, since the row it signs has to
-- be a row like any other — and the bucket holds no picture for it, so the
-- welcome falls back to the product's own drawing the way anybody without one
-- falls back to a letter.
--
-- `ON CONFLICT DO NOTHING` throughout, so this is safe to re-run and safe on a
-- database where somebody has already taken the address or the handle: the
-- insert does nothing rather than failing the migration, and the page treats a
-- missing Parea actor as "no welcome" rather than as an error.
INSERT INTO "account" ("id", "email")
VALUES ('00000000-0000-4000-8000-000000000001', 'demetri@daed.io')
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
INSERT INTO "actor" ("id", "kind", "display_name", "handle", "account_id")
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'user',
  'Parea',
  'parea',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT DO NOTHING;
