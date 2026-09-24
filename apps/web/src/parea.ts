/**
 * The product's own account.
 *
 * Parea says one thing to anybody: the welcome on an empty Notifications page.
 * That row has to be a row like the ones that will replace it — a name that
 * opens a profile, a handle that resolves, a picture where the pictures go —
 * and the only way a name does those things here is to be an account.
 *
 * So it is one, seeded by `0037_parea_account.sql`, and these are the two ids
 * that migration writes. Named rather than looked up: the alternative is a
 * query by email on every render of a page that mostly has nothing to say,
 * and an email in the code either way. `activity-page.test.ts` compares these
 * against the migration, because two files holding one uuid is exactly the
 * pair that drifts.
 *
 * ## What it deliberately is not
 *
 * Not a `kind` on the actor table, not a boolean column, not a check anywhere
 * in `access.ts`. It has no powers: it cannot see an album, it is in no group,
 * and nothing anywhere asks whether an actor is this one before deciding
 * something. It is an account that happens to be the product's, which is what
 * keeps the row it signs honest — if Parea could do things no account can do,
 * a row from Parea would not be a row.
 */

/** The account row — `demetri@daed.io`, normalised as `normaliseEmail` does. */
export const PAREA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
export const PAREA_EMAIL = 'demetri@daed.io';

/** The actor that signs the welcome, and whose profile `@parea` opens. */
export const PAREA_ACTOR_ID = '00000000-0000-4000-8000-000000000002';
export const PAREA_HANDLE = 'parea';
export const PAREA_NAME = 'Parea';

/**
 * What hiding Parea's welcome writes.
 *
 * `hidden_activity` takes a free-text key: the feed's own id for a line, which
 * is not a foreign key to anything. Every other key names a row that exists;
 * this one names a thing that happens once per reader, so a constant is the
 * honest key.
 *
 * Here rather than beside the query that reads it back, and the reason is the
 * module boundary rather than taste: the row is a client component — it hides
 * itself on a press — and `activity.ts` opens the database, so importing the
 * key from there pulls `node:fs/promises` into the browser bundle. This file
 * is constants and nothing else, which is what makes it safe for both sides.
 */
export const WELCOME_KEY = 'welcome';
