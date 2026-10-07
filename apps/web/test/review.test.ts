/**
 * The App Review account: one address, a fixed code, nothing else.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isReviewSignIn } from '@/review';

const env = { APP_REVIEW_EMAIL: 'AppReview@Parea.photos', APP_REVIEW_CODE: '482916' };

describe('the review sign-in', () => {
  it('admits the review address with its code, however it is cased or spaced', () => {
    expect(isReviewSignIn('appreview@parea.photos', '482916', env)).toBe(true);
    expect(isReviewSignIn(' APPREVIEW@parea.photos', '482 916', env)).toBe(true);
  });

  it('admits nobody else with that code, and that address with no other', () => {
    expect(isReviewSignIn('someone@parea.photos', '482916', env)).toBe(false);
    expect(isReviewSignIn('appreview@parea.photos', '482917', env)).toBe(false);
    expect(isReviewSignIn('appreview@parea.photos', '', env)).toBe(false);
  });

  it('is off unless both are set, and set to something well formed', () => {
    expect(isReviewSignIn('appreview@parea.photos', '482916', {})).toBe(false);
    expect(isReviewSignIn('appreview@parea.photos', '482916', { APP_REVIEW_EMAIL: env.APP_REVIEW_EMAIL })).toBe(false);
    expect(isReviewSignIn('appreview@parea.photos', '482916', { APP_REVIEW_CODE: '482916' })).toBe(false);
    expect(isReviewSignIn('appreview@parea.photos', 'abc', { ...env, APP_REVIEW_CODE: 'abc' })).toBe(false);
  });

  it('is checked only after both rate limits', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../app/api/account/session/route.ts', import.meta.url)),
      'utf8',
    );
    const review = route.indexOf('isReviewSignIn(email, code)');
    expect(review).toBeGreaterThan(-1);
    expect(route.indexOf('SIGN_IN_VERIFY_LIMIT')).toBeLessThan(review);
    expect(route.indexOf('SIGN_IN_VERIFY_ADDRESS_LIMIT')).toBeLessThan(review);
  });
});
