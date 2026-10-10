/**
 * The one account App Review signs in with.
 *
 * Parea signs people in with a code sent to their email, and a reviewer has no
 * inbox of ours to read it from — so without this, review stops at the sign-in
 * screen (Guideline 2.1). `APP_REVIEW_EMAIL` and `APP_REVIEW_CODE` name one
 * address and a fixed six-digit code for it; that address, with that code, is
 * signed in as if the code had been mailed.
 *
 * Narrow on purpose:
 *
 * - **Off unless both are set**, and the code must be a well-formed sign-in
 *   code, so a half-configured deployment admits nobody new.
 * - **One address.** Every other address goes through the mailed code exactly
 *   as before; this does not make any code work anywhere else.
 * - **After the rate limits.** The caller checks both the per-source and the
 *   per-address budgets first, so the fixed code is no easier to guess than a
 *   mailed one.
 * - **Compared in constant time**, like every other secret here.
 *
 * Remove `APP_REVIEW_CODE` once the app is approved and this does nothing;
 * set it again for the next review.
 */

import { timingSafeEqual } from 'node:crypto';

import { normaliseEmail, normaliseSignInCode } from '@parea/core';

/**
 * Whether this is the review address, with the review code configured — so
 * `/api/account/code` sends it nothing. The address has no mailbox: every code
 * mailed to it bounced, then sat on the provider's suppression list, and each
 * one was a send to a dead address and an alert about it. The answer to the
 * caller is the same 204 as for any other address.
 */
export function isReviewAddress(
  email: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const reviewEmail = env.APP_REVIEW_EMAIL ? normaliseEmail(env.APP_REVIEW_EMAIL) : null;
  const reviewCode = env.APP_REVIEW_CODE ? normaliseSignInCode(env.APP_REVIEW_CODE) : null;
  return Boolean(reviewEmail && reviewCode && normaliseEmail(email) === reviewEmail);
}

export function isReviewSignIn(
  email: string,
  code: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const reviewEmail = env.APP_REVIEW_EMAIL ? normaliseEmail(env.APP_REVIEW_EMAIL) : null;
  const reviewCode = env.APP_REVIEW_CODE ? normaliseSignInCode(env.APP_REVIEW_CODE) : null;
  if (!reviewEmail || !reviewCode) return false;
  if (normaliseEmail(email) !== reviewEmail) return false;
  const given = normaliseSignInCode(code);
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(reviewCode);
  return a.length === b.length && timingSafeEqual(a, b);
}
