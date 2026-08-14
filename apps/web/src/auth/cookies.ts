/**
 * Guest identity and capability cookies — docs/design.md §3.
 *
 * Two cookies, doing different jobs:
 *
 *   pa_actor      who you are. Site-wide, 400 days, minted on first
 *                 contribution rather than first visit, so a browsing visitor
 *                 never becomes a tracked entity. The same guest at three
 *                 parties is one actor, which is what makes the eventual
 *                 "you have 60 photos across 3 events" upgrade prompt true.
 *
 *   pa_cap_<id>   that you hold this event's credential. Set once, when a
 *                 valid link is visited, so the link token appears in exactly
 *                 one URL and subsequent API calls carry no secret. Includes
 *                 the event's cap_epoch, so rotating the link invalidates
 *                 every outstanding capability.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACTOR_COOKIE = 'pa_actor';
export const ACTOR_COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // browser cap

/**
 * The prefix on its own, because signing out has to find them all.
 *
 * One capability cookie exists per event this browser has opened a link to,
 * and there is no list of them anywhere else — the names *are* the record. A
 * second literal `pa_cap_` somewhere else is a rename away from a sign-out
 * that silently leaves them behind.
 */
export const CAPABILITY_PREFIX = 'pa_cap_';

export function capabilityCookieName(eventId: string): string {
  return `${CAPABILITY_PREFIX}${eventId}`;
}

/**
 * Everything signing out has to remove, given what the browser is carrying.
 *
 * Pure, and separate from the route that does it, because the interesting part
 * is not the deleting — it is deciding *what*. Identity alone is the wrong
 * answer: a capability cookie is what actually opens an event, and one left
 * behind on a shared computer hands the next person the photographs. Anything
 * else the site sets stays, so a preference does not get taken away by a
 * button that said it was about signing out.
 */
export function cookiesToClear(present: string[]): string[] {
  return present.filter(
    (name) => name === ACTOR_COOKIE || name.startsWith(CAPABILITY_PREFIX),
  );
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production');
    }
    return 'dev-secret-not-for-production';
  }
  return value;
}

export function sign(value: string): string {
  const mac = createHmac('sha256', secret()).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const cut = signed.lastIndexOf('.');
  if (cut <= 0) return null;
  const value = signed.slice(0, cut);
  const provided = Buffer.from(signed.slice(cut + 1));
  const expected = Buffer.from(
    createHmac('sha256', secret()).update(value).digest('base64url'),
  );
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? value : null;
}

export type CapabilityClaim = { eventId: string; capEpoch: number };

export function encodeCapability(claim: CapabilityClaim): string {
  return sign(`${claim.eventId}:${claim.capEpoch}`);
}

export function decodeCapability(
  signed: string | undefined,
): CapabilityClaim | null {
  const value = unsign(signed);
  if (!value) return null;
  const cut = value.lastIndexOf(':');
  if (cut <= 0) return null;
  const eventId = value.slice(0, cut);
  const capEpoch = Number(value.slice(cut + 1));
  if (!Number.isInteger(capEpoch)) return null;
  return { eventId, capEpoch };
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;
