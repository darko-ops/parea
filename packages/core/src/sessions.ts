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

import { lt, or } from 'drizzle-orm';

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
