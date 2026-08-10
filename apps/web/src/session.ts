/**
 * Reading identity out of a request, and minting it when there isn't any.
 *
 * The rule from design §3: an actor is minted on first *contribution*, not
 * first visit. Browsing an event you were linked to should not create a
 * durable record of you.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

import type { Requester } from './access';
import type { Db } from './db';
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

export async function currentActorId(): Promise<string | null> {
  const jar = await cookies();
  return unsign(jar.get(ACTOR_COOKIE)?.value);
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
    actorId: unsign(jar.get(ACTOR_COOKIE)?.value),
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
