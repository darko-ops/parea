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

/**
 * What an actor credential says — design §3.
 *
 * `<actor id>:<session id>`, signed as one string so the pair cannot be taken
 * apart and recombined. Both carriers use it: the browser's `pa_actor` cookie
 * and the bearer token in the app's keychain are the same value.
 *
 * ## The session id is the authority, and the actor id is not
 *
 * Once a session row exists, it is what decides — it holds the current actor
 * and it is what revoking ends. The actor id travels alongside for one reason:
 * a credential issued before this table existed has only that, and those still
 * have to work. Reading it on a credential that has both would be reading the
 * stale half, because a merge moves the session row and cannot reach into a
 * keychain to rewrite the token.
 */
export type ActorCredential = { actorId: string; sessionId: string | null };

const CREDENTIAL_SEPARATOR = ':';

export function encodeCredential(credential: ActorCredential): string {
  const { actorId, sessionId } = credential;
  return sign(sessionId ? `${actorId}${CREDENTIAL_SEPARATOR}${sessionId}` : actorId);
}

/**
 * Reads one back, accepting both shapes.
 *
 * A value with no separator is a credential from before sessions existed. It
 * is not rejected: every browser and every phone that was signed in on the
 * day this shipped is carrying one, and refusing them would have signed out
 * everybody to add a screen that lists who is signed in.
 */
export function decodeCredential(signed: string | undefined): ActorCredential | null {
  const value = unsign(signed);
  if (!value) return null;
  const cut = value.indexOf(CREDENTIAL_SEPARATOR);
  if (cut < 0) return { actorId: value, sessionId: null };
  const actorId = value.slice(0, cut);
  const sessionId = value.slice(cut + 1);
  if (!actorId || !sessionId) return null;
  return { actorId, sessionId };
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
