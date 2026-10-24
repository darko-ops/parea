/**
 * How long a session row is kept — design §3.
 *
 * In core rather than beside the code that reads sessions, because two
 * processes act on it: the web app, which documents the policy and shows it to
 * people on the Devices screen, and the deriver's purge job, which is what
 * actually deletes. A retention window written down twice is a retention
 * window that drifts, and the drift is invisible — the app would say one thing
 * and the job would do another, and nobody would find out until somebody was
 * signed out early with no explanation.
 *
 * The `sign_in_code` and `rate_limit` cutoffs are each written twice today for
 * want of this, and they get away with it because both are "expired means
 * expired" and the row carries its own deadline. This one is a judgement about
 * two different clocks, so it lives in one place.
 */

import { lt, or, sql } from 'drizzle-orm';

import { sessions } from './schema';

/**
 * A revoked session is kept this long before the row goes.
 *
 * Not dropped on the spot, because the Devices screen is the only place
 * anybody learns that a sign-out worked. A row that vanishes the instant it is
 * revoked cannot answer "did that take effect?" on the next page load, and the
 * question is the reason somebody pressed the button.
 */
export const REVOKED_RETENTION_DAYS = 7;

/**
 * An unused session is kept this long — deliberately longer than the cookie.
 *
 * The credential itself lasts 400 days. Deleting the row it resolves through
 * any earlier would sign somebody out on a schedule nothing told them about:
 * their cookie still verifies, and the row is simply gone. So the credential's
 * own expiry is what ends a session, and this only sweeps up what is already
 * dead.
 */
export const SESSION_RETENTION_DAYS = 440;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows the purge job drops: long revoked, or unused past the window. */
export function staleSessions(now: Date) {
  return or(
    lt(sessions.revokedAt, new Date(now.getTime() - REVOKED_RETENTION_DAYS * DAY_MS)),
    lt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_RETENTION_DAYS * DAY_MS)),
  );
}

/**
 * How long a signed-in session lasts: ninety days unused, or a year in all.
 *
 * Before these a session ended only when somebody revoked it. The cookie
 * lasts four hundred days and an app's token has no end at all, so a phone in
 * a drawer, or a credential copied off a laptop, stayed signed in until its
 * owner thought to look at the Devices screen. Idle does the work — a device
 * in use is touched every quarter of an hour and never comes near it — and the
 * absolute bound means no one sign-in is good forever, however busy. Signing
 * in again is an emailed code, which is what makes asking once a year cheap.
 *
 * Only for somebody with an account. A guest — somebody who added photographs
 * and never signed in — has no way to sign back in: their session *is* who
 * they are, and ending it would orphan their photographs with nobody left who
 * can delete them. They hold nothing but the rolls they took part in.
 *
 * Both the web app (on the next request) and the deriver's hourly purge (for
 * devices never used again) revoke on this, so it is written once, here.
 */
export const SESSION_IDLE_DAYS = 90;
export const SESSION_MAX_DAYS = 365;

/**
 * A live session of somebody with an account that is past either bound.
 * Raw SQL over the `session` table, unaliased, for the statements that need
 * it inside a CTE as well as for the query builder.
 */
export const expiredSession = sql`(
  "session"."revoked_at" is null
  and exists (
    select 1 from "actor"
     where "actor"."id" = "session"."actor_id" and "actor"."account_id" is not null
  )
  and (
    "session"."last_seen_at" < now() - ${sql.raw(`interval '${SESSION_IDLE_DAYS} days'`)}
    or coalesce("session"."signed_in_at", "session"."created_at") < now() - ${sql.raw(`interval '${SESSION_MAX_DAYS} days'`)}
  )
)`;
