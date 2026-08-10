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
 * The signed form of an actor id, for a native client to keep in the keychain.
 * Identical to the cookie value — there is one credential format.
 */
export function actorToken(actorId: string): string {
  return sign(actorId);
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

  const jar = await cookies();
  jar.set(ACTOR_COOKIE, sign(actor!.id), {
    ...COOKIE_OPTIONS,
    maxAge: ACTOR_COOKIE_MAX_AGE,
  });
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
