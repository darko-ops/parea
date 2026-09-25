/**
 * Reading identity out of a request, and minting it when there isn't any.
 *
 * The rule from design §3: an actor is minted on first *contribution*, not
 * first visit. Browsing an event you were linked to should not create a
 * durable record of you.
 */

import { schema, type ClientKind } from '@parea/core';
import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';

import type { Requester } from './access';
import { getDb, type Db } from './db';
import { resolveActor } from './merge';
import {
  adoptSession,
  resolveSession,
  revokeSession,
  startSession,
  type SignInMethod,
} from './sessions';
import {
  ACTOR_COOKIE,
  ACTOR_COOKIE_MAX_AGE,
  COOKIE_OPTIONS,
  capabilityCookieName,
  cookiesToClear,
  decodeCapability,
  decodeCredential,
  encodeCapability,
  encodeCredential,
  type ActorCredential,
} from './auth/cookies';

/**
 * The one place that branches on client type — design §3.
 *
 * The web carries identity in a signed httpOnly cookie; native carries the
 * same signed value as a bearer token out of the keychain, because a native
 * client has no cookie jar worth relying on. Same string, same signature, same
 * credential on the other side: everything downstream sees an actor and does
 * not know or care how it arrived.
 */
async function bearerCredential(): Promise<ActorCredential | null> {
  const header = (await headers()).get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return decodeCredential(header.slice(7).trim());
}

/** Who is asking, and which of their devices is asking. */
export type CurrentCredential = { actorId: string; sessionId: string | null };

/**
 * Resolves the credential on this request to an actor and a device.
 *
 * Two shapes arrive here and they are resolved differently.
 *
 * **A credential naming a session** is decided by the session row, which is
 * the authority: it holds the current actor, and a merge moves it, so no
 * pointer has to be chased. If the row is revoked or gone, this answers null —
 * that is what a remote sign-out *is*, and it is the reason the row exists.
 *
 * **A credential with no session id** was issued before the table existed and
 * still has to work; there are cookies and keychains full of them. Those take
 * the old path and follow `merged_into_id`, and they are the one kind of
 * credential this product cannot list or revoke. `/api/account/devices` mints
 * a session for one the first time somebody looks at that screen, so the gap
 * closes itself for anybody who goes looking.
 *
 * ## Failing closed
 *
 * A database error here reads as signed out rather than as signed in, which
 * is the opposite of how the rate limiter treats the same failure — and
 * deliberately, because that one bounds abuse and this one is authorization.
 * It costs nothing real: every page in this product needs the database, so a
 * deployment that cannot answer this question cannot draw the page either.
 */
export async function currentCredential(): Promise<CurrentCredential | null> {
  const jar = await cookies();
  const presented = decodeCredential(jar.get(ACTOR_COOKIE)?.value) ?? (await bearerCredential());
  if (!presented) return null;

  const db = getDb();

  if (presented.sessionId) {
    const live = await resolveSession(db, presented.sessionId).catch(() => null);
    if (!live) return null;
    return { actorId: live.actorId, sessionId: presented.sessionId };
  }

  // The old path, unchanged. When someone signs in on a second device their
  // old actor is folded into the account's, but this phone's keychain still
  // holds the old token — and it has to keep working, because the alternative
  // is asking someone to sign in again on the device they just signed in on.
  //
  // The one place the pointer is read. Everything downstream sees a single
  // actor id and has no idea a merge ever happened, which is the point:
  // resolving it per call site is how one gets missed.
  const actorId = await resolveActor(db, presented.actorId).catch(() => presented.actorId);

  /*
   * Said out loud, because the decision this blocks cannot be made without it.
   *
   * A credential with no session id is the one shape this product cannot
   * revoke — `/api/account/devices` mints a row for a browser that visits it
   * and the app does the same on launch, so the population shrinks on its own,
   * but nothing anywhere records how fast. Closing the gap properly means
   * refusing these outright, and that signs those people out; picking the day
   * to do it without knowing whether it is five people or five hundred is
   * guessing with somebody else's session.
   *
   * A log line rather than a row in `observation`: that table is a closed list
   * tied to the §18 metrics and says so, and "how many old cookies are left"
   * is an operational question about a migration rather than a fact about the
   * product. This costs nothing, stores nothing, and stops the day the last
   * one is adopted — which is exactly the signal being waited for.
   */
  console.info(`legacy-credential: resolved actor ${actorId} with no session row`);

  return { actorId, sessionId: null };
}

export async function currentActorId(): Promise<string | null> {
  return (await currentCredential())?.actorId ?? null;
}

/** Which device is asking, for the screen that lists them. */
export async function currentSessionId(): Promise<string | null> {
  return (await currentCredential())?.sessionId ?? null;
}

/**
 * What kind of client this is, for the label on its row.
 *
 * The app says so itself when it asks for a token; a browser is inferred from
 * its user agent, which is the only thing it offers.
 */
export async function userAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}

/**
 * The host this request was served on, for the WebAuthn ceremony.
 *
 * `Host` rather than `Origin`, and the distinction is the whole reason this is
 * a function with a comment on it: `Origin` is a claim the caller makes about
 * itself, and `Host` is what the request was routed on. A passkey's RP ID and
 * expected origins are derived from this, so a value a caller could choose
 * would be a caller choosing which origins count. See `expectedOrigins`.
 */
export async function requestHost(): Promise<string | null> {
  return (await headers()).get('host');
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
 * The signed credential for a native client to keep in the keychain.
 * Identical to the cookie value — there is one credential format.
 */
export function actorToken(actorId: string, sessionId: string | null): string {
  return encodeCredential({ actorId, sessionId });
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
 *
 * `sessionId` is what makes the credential revocable. Null is permitted and
 * means the old shape — kept so that a caller with nothing to record is not
 * forced to invent a row, not because anything still issues one.
 */
export async function issueActorCookie(
  actorId: string,
  sessionId: string | null = null,
): Promise<void> {
  const jar = await cookies();
  jar.set(ACTOR_COOKIE, encodeCredential({ actorId, sessionId }), {
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
 * ## The session is revoked, and that is new
 *
 * This used to delete cookies and nothing else, on the grounds that an actor
 * is not a session and there was nothing on the server to end. There is now,
 * and ending it is the difference between "this browser has forgotten you"
 * and "this credential no longer works" — which matters for the copy of the
 * cookie somebody took off a shared machine before the owner came back.
 *
 * Both halves still run if the first one fails. A session left live is a row
 * on a list with no client holding its credential, which is untidy; cookies
 * left behind on a shared computer are the thing this button exists for.
 */
export async function signOutBrowser(): Promise<void> {
  const credential = await currentCredential().catch(() => null);
  if (credential?.sessionId) {
    await revokeSession(getDb(), credential.actorId, credential.sessionId).catch((err) => {
      console.error(`sign-out could not revoke session ${credential.sessionId}: ${err}`);
    });
  }

  const jar = await cookies();
  for (const name of cookiesToClear(jar.getAll().map((c) => c.name))) {
    jar.delete(name);
  }
}

/**
 * Creates a guest actor and sets the cookie. Call only when contributing.
 *
 * ## Why the presented id is checked against the table
 *
 * A cookie outlives the row it names. Not hypothetically: the production
 * database was replaced, and every browser carrying an actor cookie from the
 * old one presented an id that no longer existed.
 *
 * Trusting it produced the worst shape of failure available. `ensureActor`
 * returned the id without creating anything, `bindAccount` wrote the account
 * and then updated an actor that was not there — matching no rows and
 * reporting nothing — and the endpoint answered 200. The next request asked
 * which account that actor belonged to, found no actor, and said signed out.
 * A success that signs nobody in, with no error anywhere: the form simply
 * cleared and people typed the code again.
 *
 * The same thing happens without a migration. An actor deleted by a merge, a
 * restore from an older snapshot, a database reset in development — anything
 * that removes the row while the cookie survives.
 *
 * So the id is only worth what the table says. One extra read on a path that
 * already writes, in exchange for a state that cannot be diagnosed from the
 * outside.
 */
export async function ensureActor(
  db: Db,
  displayName?: string,
  /**
   * `recordSession: false` mints the actor and the cookie without a session row.
   *
   * One caller passes it, and it is the sign-in route. That route has to record
   * a session of its own — with the actor the account resolved to, which a merge
   * can change, and with how somebody proved who they were — so a row minted
   * here would be a second row for the same browser. Only one of the two would
   * ever be used again, and nothing on either would say which: a phantom "added
   * photos before signing in" line on a screen whose entire job is letting
   * somebody spot a device that is not theirs.
   *
   * Deliberately not solved by reading back the cookie this function just set.
   * That works — Next reflects a write into subsequent reads in the same
   * request — but it makes the absence of a duplicate row depend on a framework
   * behaviour rather than on the code, and the symptom if it ever changed would
   * be a spurious row on a security screen rather than an error.
   */
  { recordSession = true }: { recordSession?: boolean } = {},
): Promise<string> {
  const existing = await currentActorId();
  if (existing) {
    const [row] = await db
      .select({ id: schema.actors.id })
      .from(schema.actors)
      .where(eq(schema.actors.id, existing))
      .limit(1);

    if (row) {
      if (displayName) {
        await db
          .update(schema.actors)
          .set({ displayName })
          .where(eq(schema.actors.id, existing));
      }
      return existing;
    }
    // Falls through and mints a new one. The stale cookie is overwritten
    // below rather than cleared first: a browser that presented a dead id
    // should leave with a live one, not with nothing.
  }

  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName: displayName ?? null })
    .returning();

  /*
   * A cookie for a browser, and nothing for a native client.
   *
   * This issued one unconditionally, which quietly handed the app a second
   * identity: iOS keeps a shared cookie jar and sends it without being asked,
   * and `currentActorId` reads the cookie *before* the bearer token. So a phone
   * that had ever reached this line was thereafter identified by something it
   * had no way to clear — and signing out, which clears the token and the
   * keychain, left the server still answering as the person who signed out.
   *
   * The rule was already written down one route away, at sign-in: "browsers
   * only: native carries the same value as a bearer token and has no cookie jar
   * worth writing to". This is that rule, applied where an actor is actually
   * minted.
   *
   * A native caller that gets here has no way to learn the actor it just
   * created, which is a real gap and not a new one — the cookie was hiding it
   * rather than solving it. The app does not rely on it: `POST /api/session`
   * mints an actor and hands back a token, which is how the phone gets an
   * identity it can keep and can throw away.
   *
   * The session row is minted with the cookie rather than with the actor, for
   * the same reason: it records a credential that was issued, and nothing was
   * issued to a native caller here.
   */
  if (await fromBrowser()) {
    const session = recordSession
      ? await startSession(db, {
          actorId: actor!.id,
          kind: 'browser',
          userAgent: await userAgent(),
          // Contributing is not signing in. The row exists so this browser can
          // be listed and ended once there *is* an account to list it under,
          // and `adoptSession` relabels it at that point rather than leaving
          // two.
          method: 'guest',
        })
      : null;
    await issueActorCookie(actor!.id, session?.id ?? null);
  }
  return actor!.id;
}

/**
 * Puts this client on the device list, and hands it the credential to prove it.
 *
 * The tail of every sign-in — by code or by passkey, on a browser or in the
 * app — so that the two routes differ in how they establish *who* somebody is
 * and in nothing else.
 *
 * ## Why the existing session is reused
 *
 * Somebody signing in on the laptop they have been browsing on already has a
 * row for that laptop: it was minted when they first added a photograph, as a
 * guest. Minting a second would put two rows on the Devices screen for one
 * browser, and only one of them would ever be used again — with nothing on
 * either to say which. So the row is re-pointed and re-labelled instead, which
 * is what actually happened: the same browser, signed in differently now.
 *
 * Returns the session id, which the caller puts in the cookie or the token.
 */
export async function establishSession(
  db: Db,
  actorId: string,
  method: SignInMethod,
  kind: ClientKind = 'browser',
): Promise<string> {
  const presented = await currentCredential().catch(() => null);
  if (presented?.sessionId) {
    // False when the row is revoked or gone — a credential that was signed
    // out from another device, being used to sign in again. That is a new
    // session and not a resurrection of the one somebody ended.
    const adopted = await adoptSession(db, presented.sessionId, actorId, method);
    if (adopted) return presented.sessionId;
  }

  const session = await startSession(db, {
    actorId,
    kind,
    userAgent: await userAgent(),
    method,
  });
  return session.id;
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
