/**
 * Reading identity out of a request, and minting it when there isn't any.
 *
 * The rule from design §3: an actor is minted on first *contribution*, not
 * first visit. Browsing an event you were linked to should not create a
 * durable record of you.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';

import type { Requester } from './access';
import { getDb, type Db } from './db';
import { resolveActor } from './merge';
import {
  ACTOR_COOKIE,
  ACTOR_COOKIE_MAX_AGE,
  COOKIE_OPTIONS,
  capabilityCookieName,
  cookiesToClear,
  decodeCapability,
  encodeCapability,
  sign,
  unsign,
} from './auth/cookies';

/**
 * The one place that branches on client type — design §3.
 *
 * The web carries identity in a signed httpOnly cookie; native carries the
 * same signed value as a bearer token out of the keychain, because a native
 * client has no cookie jar worth relying on. Same string, same signature, same
 * actor id on the other side: everything downstream sees an actor and does not
 * know or care how it arrived.
 */
async function bearerActorId(): Promise<string | null> {
  const header = (await headers()).get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return unsign(header.slice(7).trim());
}

export async function currentActorId(): Promise<string | null> {
  const jar = await cookies();
  const presented = unsign(jar.get(ACTOR_COOKIE)?.value) ?? (await bearerActorId());
  if (!presented) return null;

  // Follows a merge. When someone signs in on a second device their old actor
  // is folded into the account's, but this phone's keychain still holds the
  // old token — and it has to keep working, because the alternative is asking
  // someone to sign in again on the device they just signed in on.
  //
  // The one place the pointer is read. Everything downstream sees a single
  // actor id and has no idea a merge ever happened, which is the point:
  // resolving it per call site is how one gets missed.
  return resolveActor(getDb(), presented).catch(() => presented);
}

/**
 * The acting actor, but only if there is an account behind it.
 *
 * `currentActorId` answers for a guest as readily as for anybody else — an
 * actor exists for every browser that has ever opened a link, and that is what
 * makes "your photos are yours to delete" work without a login. It is exactly
 * the wrong thing to check before letting somebody write in a thread, and a
 * route that checks it is checking "is there a browser here".
 *
 * The distinction matters because posting is the one thing in this product
 * that puts a name in front of other people. A photograph carries a name too,
 * but a photograph is the thing an event is for; a message is somebody
 * addressing the room, and a room where anyone holding the link can speak
 * anonymously is a different product with a different moderation problem.
 *
 * Returns null for a guest, which callers answer as `sign_in_required` — a
 * 401 rather than a 403, because the remedy is signing in and the client has a
 * screen for exactly that.
 */
export async function currentAccountActorId(): Promise<string | null> {
  const actorId = await currentActorId();
  if (!actorId) return null;

  const [actor] = await getDb()
    .select({ accountId: schema.actors.accountId })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId));

  return actor?.accountId ? actorId : null;
}

/**
 * The signed form of an actor id, for a native client to keep in the keychain.
 * Identical to the cookie value — there is one credential format.
 */
export function actorToken(actorId: string): string {
  return sign(actorId);
}

/**
 * Whether this request came from a browser, for the two routes that hand out
 * an actor token.
 *
 * They withhold it when this is true. One credential format is a good thing;
 * putting it where a page's JavaScript can read it is not. The cookie is
 * `httpOnly` precisely so a script cannot lift it, and a same-origin `fetch`
 * answering with the same signed string undoes that in one line — worse than
 * the cookie, because the token survives clearing site data and, now that
 * accounts exist, names a person rather than a throwaway guest. The web needs
 * it for nothing: every web caller is same-origin and already carries the
 * cookie on the request.
 *
 * The signal is `Sec-Fetch-Mode`. Every current browser sends the
 * fetch-metadata headers on every request, and the `Sec-` prefix makes them
 * forbidden header names, so a script can neither add nor strip them: this is
 * the browser's word rather than the caller's, which is the only kind worth
 * having against an attacker who is already running in the page.
 *
 * Not the actor cookie, which is the tempting one and is wrong. React Native
 * shares the platform cookie store on both iOS and Android, so the app *does*
 * send back a cookie the server once set — and withholding the token from it
 * would leave the app unable to keep its own identity, which is worse than
 * what this protects against.
 *
 * Safari before 16.4 sends no fetch metadata and is handed a token, which is
 * where every browser was before this existed. It fails in the direction of
 * the old behaviour rather than of a broken client.
 */
export async function fromBrowser(): Promise<boolean> {
  return (await headers()).get('sec-fetch-mode') !== null;
}

/**
 * Issues the actor cookie, or re-issues it.
 *
 * Called when an actor is first minted and again at sign-in. The second one
 * matters for two reasons. The clock restarts, so the 400 days runs from the
 * last time someone proved who they were rather than from whenever this
 * browser first touched the product — otherwise a person who uses it for a
 * year is signed out mid-use by a timer that started before they had an
 * account. And the value is updated: signing in can fold this browser's actor
 * into the account's canonical one, and without this the cookie keeps naming
 * the old one forever, resolved on every request by following a merge pointer
 * that only has to be tidied once to take the session with it.
 */
export async function issueActorCookie(actorId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTOR_COOKIE, sign(actorId), {
    ...COOKIE_OPTIONS,
    maxAge: ACTOR_COOKIE_MAX_AGE,
  });
}

/**
 * Signing out: forget this browser entirely.
 *
 * Both kinds of cookie go, and the capability ones are the reason this is not
 * a one-liner. `pa_actor` says who you are; every `pa_cap_<id>` says that this
 * browser holds an event's credential, and they are what actually open the
 * photographs — clearing identity while leaving them behind would sign
 * somebody out of their account and leave the next person at the same computer
 * looking at the events they had opened. On a shared machine that is the whole
 * point of the button.
 *
 * Nothing is revoked server-side, because there is nothing to revoke: an actor
 * is not a session and the cookie is not a session id. Which is also why this
 * is honest about its limits — a copy of the cookie taken elsewhere is not
 * affected, and only rotating an event's link ends that.
 */
export async function signOutBrowser(): Promise<void> {
  const jar = await cookies();
  for (const name of cookiesToClear(jar.getAll().map((c) => c.name))) {
    jar.delete(name);
  }
}

/** Creates a guest actor and sets the cookie. Call only when contributing. */
export async function ensureActor(db: Db, displayName?: string): Promise<string> {
  const existing = await currentActorId();
  if (existing) {
    if (displayName) {
      await db
        .update(schema.actors)
        .set({ displayName })
        .where(eq(schema.actors.id, existing));
    }
    return existing;
  }

  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName: displayName ?? null })
    .returning();

  await issueActorCookie(actor!.id);
  return actor!.id;
}

/**
 * Builds the credential picture for a request: who they are, and what they
 * hold. `linkToken` is only ever read from an explicit body/query parameter —
 * the ambient path is the capability cookie, so the secret does not travel on
 * every request.
 */
export async function requesterFor(
  eventId: string,
  extra: { linkToken?: string; code?: string } = {},
): Promise<Requester> {
  const jar = await cookies();
  const claim = decodeCapability(jar.get(capabilityCookieName(eventId))?.value);
  return {
    actorId: await currentActorId(),
    linkToken: extra.linkToken,
    code: extra.code,
    capEpoch: claim?.eventId === eventId ? claim.capEpoch : undefined,
  };
}

/**
 * Exchanges a valid link for a scoped capability cookie, so the token appears
 * in exactly one URL and never again (design §3).
 */
export async function grantCapability(
  eventId: string,
  capEpoch: number,
): Promise<void> {
  const jar = await cookies();
  jar.set(capabilityCookieName(eventId), encodeCapability({ eventId, capEpoch }), {
    ...COOKIE_OPTIONS,
    maxAge: 400 * 24 * 60 * 60,
  });
}
