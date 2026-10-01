/**
 * Prove who you are, and become the account — design §3.
 *
 * The response is an actor token, the same signed value everything else uses.
 * An account is not a second kind of credential: it resolves to an actor, and
 * from there the product works exactly as it did.
 *
 * ## Two proofs, one route
 *
 * A code from an inbox, or an assertion from a passkey. They are different
 * questions — *can you read this mailbox* and *do you hold this device and are
 * you the person it recognises* — and everything after the answer is identical:
 * the same actor, the same merge, the same handle, the same session, the same
 * cookie. Two routes would have been two copies of that tail, and the tail is
 * the part where a missed step means somebody's photographs stop being theirs.
 *
 * So the branch is four lines wide at the top of `POST` and nothing below it
 * knows which way somebody came in.
 */

import { normaliseEmail, normaliseSignInCode, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { accountExists, accountFor, consumeCode, signIn } from '@/accounts';
import { MINIMUM_AGE, ageOn, ageProof, checkAgeProof } from '@/age';
import { getDb } from '@/db';
import { isSuspended } from '@/suspension';
import { hasPasskey, passkeyOwnerHasAccount, verifyAuthentication } from '@/passkeys';
import {
  SIGN_IN_VERIFY_ADDRESS_LIMIT,
  SIGN_IN_VERIFY_LIMIT,
  withinLimit,
  withinLimitFor,
} from '@/ratelimit';
import {
  actorToken,
  currentActorId,
  ensureActor,
  establishSession,
  fromBrowser,
  issueActorCookie,
  presentedSignedOut,
  requestHost,
  signOutBrowser,
} from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const actorId = await currentActorId();
  /*
   * `signedOut` says the credential on this request was ended elsewhere — the
   * Devices screen on another device. The app holds its lists in memory and
   * would otherwise keep drawing somebody's albums under a session the server
   * stopped honouring; this is how it learns to clear them.
   */
  if (!actorId) return NextResponse.json({ account: null, signedOut: await presentedSignedOut() });
  return NextResponse.json({ account: await accountFor(getDb(), actorId) });
}

/**
 * Sign out — give the session back, keep the account.
 *
 * On this route rather than its own, because it is the exact opposite of the
 * POST above: that one takes a code and hands back a session, this one hands
 * the session back. `DELETE /api/account` is a different thing entirely — it
 * removes the account — and the two would be one letter apart in a fetch call
 * if this lived there.
 *
 * Nothing is read and nothing is checked. Signing out an actor who is not
 * signed in is what a stale tab does, and it should answer the same as any
 * other sign-out: you are not signed in now.
 */
export async function DELETE() {
  await signOutBrowser();
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
  // Unlike `/api/session`, this one has a browser caller — the sign-in page —
  // so it answers normally and only withholds the token.
  const browser = await fromBrowser();

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    code?: unknown;
    passkey?: unknown;
    platform?: unknown;
    /** `YYYY-MM-DD`, asked only when this sign-in would make the account. */
    birthDate?: unknown;
    /** From the answer that asked for it, so no second code is needed. */
    proof?: unknown;
    /** The name typed on Create account. Used only if this makes the account. */
    displayName?: unknown;
    /** `create` from the Create account form, which must not sign anybody in. */
    intent?: unknown;
  };

  const db = getDb();
  const method = body.passkey ? 'passkey' : 'code';

  /*
   * Whose account this is, established one of two ways.
   *
   * Both branches answer with an address and nothing else, because the address
   * is what `signIn` binds and merges on — so a passkey sign-in and a code
   * sign-in converge before either of them touches an actor.
   */
  const proven = body.passkey
    ? await provenByPasskey(db, body.passkey)
    : body.proof
      ? provenByAgeProof(body.email, body.proof)
      : await provenByCode(db, body.email, body.code);

  if (!proven.ok) return proven.response;

  /*
   * The age check, for the sign-in that would make the account.
   *
   * Only an email code can make one — a passkey belongs to an account that
   * already exists — and only now, with the address proved, can the server
   * say it is new without telling a stranger whether it has an account.
   *
   * No date: the answer asks for one, with a proof of the address good for
   * ten minutes, so the next request carries the date and not a second code.
   * Under the minimum: refused, and nothing is created. The date itself is
   * never stored — see `@/age`.
   */
  const exists = await accountExists(db, proven.email);
  /*
   * The proof finishes making an account and does nothing else. It is not a
   * sign-in: once the address has an account — including the one this proof
   * just made — presenting it again is refused like a wrong code.
   */
  if (body.proof && !body.passkey && exists) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 401 });
  }

  /*
   * Create account with an address that already has one stops here.
   *
   * It used to sign them in, which is the convenient answer and the confusing
   * one: somebody who pressed Create account and landed in an account full of
   * somebody's rolls — their own, from months ago — had no way to tell what had
   * happened. So they are told, and Sign in is one tap from there.
   *
   * Only after the code. Before it, "that address has an account" would answer
   * whether a stranger uses Parea for anybody who typed their address in.
   */
  if (body.intent === 'create' && !body.passkey && !body.proof && exists) {
    return NextResponse.json({ error: 'account_exists' }, { status: 409 });
  }

  let ageConfirmedAt: Date | undefined;
  if (!body.passkey && !exists) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    if (body.birthDate === undefined) {
      return NextResponse.json(
        { error: 'birth_date_required', proof: ageProof(secret, proven.email) },
        { status: 428 },
      );
    }
    const age = ageOn(body.birthDate);
    if (age === null) {
      return NextResponse.json(
        { error: 'invalid_birth_date', proof: ageProof(secret, proven.email) },
        { status: 400 },
      );
    }
    if (age < MINIMUM_AGE) return NextResponse.json({ error: 'too_young' }, { status: 403 });
    ageConfirmedAt = new Date();
  }

  /*
   * Only now does an actor exist, if one did not — signing in *is* a
   * contribution of sorts, and it is the first point at which there is
   * something durable to attach.
   *
   * Without a session row, because this route records its own below: with the
   * actor the account resolved to, and with how they proved it. See the note on
   * `recordSession`.
   */
  const actorId = await ensureActor(db, undefined, { recordSession: false });
  const result = await signIn(db, proven.email, actorId, { ageConfirmedAt });

  /*
   * The name from the Create account form, on the account it just made.
   *
   * Only then. Somebody who pressed Create account with an address that
   * already had one is signed in to it, and a name typed on that form must not
   * quietly rename an account they made months ago. Bounded as Edit profile
   * bounds it.
   */
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
  if (result.created && displayName) {
    await db
      .update(schema.actors)
      .set({ displayName })
      .where(eq(schema.actors.id, result.actorId));
  }

  /*
   * Refused, and said so, rather than signed in to nothing.
   *
   * `resolveSession` would refuse every credential handed out below anyway, so
   * this changes no outcome — it changes what the person sees. Without it the
   * sign-in "works" and the next request finds them signed out, which reads as
   * a bug rather than a decision.
   */
  if (await isSuspended(db, result.actorId)) {
    return NextResponse.json({ error: 'suspended' }, { status: 403 });
  }

  /*
   * This device goes on the list, under the actor the account resolved to.
   *
   * After `signIn` rather than before, because a merge can change which actor
   * that is — and the row has to name the survivor or the Devices screen is
   * reading a list belonging to an actor nothing points at.
   */
  const sessionId = await establishSession(
    db,
    result.actorId,
    method,
    browser ? 'browser' : body.platform === 'android' ? 'android' : 'ios',
  );

  // Re-issued with the actor the account actually resolves to, and with the
  // clock restarted. Browsers only: native carries the same value as a bearer
  // token and has no cookie jar worth writing to.
  if (browser) await issueActorCookie(result.actorId, sessionId);

  return NextResponse.json({
    // Withheld from a browser, which already holds the same value in an
    // httpOnly cookie — see `fromBrowser`.
    ...(browser ? {} : { actorToken: actorToken(result.actorId, sessionId) }),
    email: result.email,
    // True when this device's previous identity was folded into an existing
    // one. The client uses it to say so rather than silently swapping.
    merged: result.merged,
    /*
     * True on the sign-in that created the account.
     *
     * The clients offer a passkey on the back of it — the one moment where
     * "next time, sign in with Face ID" is both new information and obviously
     * worth doing. Reported rather than inferred from `merged`, which is a
     * different fact that happens to be false at the same time.
     */
    created: result.created,
    /*
     * Whether this account already has a passkey, so the offer can be skipped
     * for somebody signing in on a second browser. One field rather than a
     * second request from a screen that is mid-flow.
     */
    hasPasskey: await hasPasskey(db, result.actorId),
  });
}

/**
 * Establishing who somebody is, by one of the two proofs.
 *
 * Both return an address on success and a finished response on failure, which
 * is what lets `POST` stay one straight line: the refusals are each written
 * where the reason for them lives, rather than as a shared error code that has
 * to be translated back into a sentence.
 */
type Proven =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

/** A code from an inbox. */
async function provenByCode(
  db: ReturnType<typeof getDb>,
  rawEmail: unknown,
  rawCode: unknown,
): Promise<Proven> {
  const email = typeof rawEmail === 'string' ? normaliseEmail(rawEmail) : null;
  const code = typeof rawCode === 'string' ? normaliseSignInCode(rawCode) : null;
  if (!email || !code) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_request' }, { status: 400 }),
    };
  }

  // Not `SIGN_IN_LIMIT`, which is the budget for *sending* mail. Presenting a
  // code sends none, and sharing one bucket meant a few requests spent the
  // allowance for answering them. See the note on the limit.
  if (!(await withinLimit(db, SIGN_IN_VERIFY_LIMIT, process.env.SESSION_SECRET))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'too_many_requests' }, { status: 429 }),
    };
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'not_configured' }, { status: 503 }),
    };
  }

  // And per address, so many sources cannot converge on one account. Counted
  // for every address presented, so a refusal says nothing about whether it
  // has an account. See the note on the limit.
  if (!(await withinLimitFor(db, SIGN_IN_VERIFY_ADDRESS_LIMIT, secret, email))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'too_many_requests' }, { status: 429 }),
    };
  }

  const check = await consumeCode(db, secret, email, code);
  if (!check.ok) {
    // One answer for every way of being wrong. Distinguishing "no code was
    // requested for this address" from "that code is wrong" would say whether
    // someone had asked, which is the same oracle the request endpoint
    // refuses to be.
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_code' }, { status: 401 }),
    };
  }

  return { ok: true, email };
}

/**
 * An assertion from a passkey.
 *
 * ## Why this branch has no rate limit of its own
 *
 * There is nothing here to guess. An assertion only verifies against a
 * challenge this server issued, and issuing those is already capped at sixty
 * an hour per source — the scarce thing is bounded at the point it is created,
 * so bounding it again here would only take allowance away from something else.
 *
 * Specifically not `SIGN_IN_VERIFY_LIMIT`: that bucket exists because somebody
 * working their own inbox was having their allowance spent by a different kind
 * of request, and adding a third kind of request to it would reintroduce
 * exactly that. See the note on the limit.
 */
/**
 * The second half of a first sign-in: the address was proved a moment ago by
 * a code, and this carries the date of birth that was asked for. See the age
 * check in `POST`.
 */
function provenByAgeProof(rawEmail: unknown, proof: unknown): Proven {
  const email = typeof rawEmail === 'string' ? normaliseEmail(rawEmail) : null;
  const secret = process.env.SESSION_SECRET;
  if (!email || !secret || !checkAgeProof(secret, email, proof)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_code' }, { status: 401 }),
    };
  }
  return { ok: true, email };
}

async function provenByPasskey(
  db: ReturnType<typeof getDb>,
  assertion: unknown,
): Promise<Proven> {
  if (typeof assertion !== 'object' || assertion === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_request' }, { status: 400 }),
    };
  }

  const outcome = await verifyAuthentication(db, {
    response: assertion as never,
    host: await requestHost(),
  });

  /*
   * One answer for every way of failing, and this one *is* an oracle worth
   * closing.
   *
   * "That key is not enrolled here" and "that signature is wrong" are
   * different facts, and the first one is about a person: somebody holding a
   * passkey for another site could learn whether the same authenticator is
   * registered with Parea, which is the question about who was at which party
   * that `/api/account/code` refuses to answer.
   */
  if (!outcome.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_passkey' }, { status: 401 }),
    };
  }

  /*
   * The key is good and the account may still be gone.
   *
   * Deleting an account leaves the actor behind as a guest, on purpose, so it
   * keeps its photographs. `deleteAccount` removes that actor's passkeys for
   * this reason, and this is the belt to that braces: a key that somehow
   * outlived its account must not be a way into one that no longer exists.
   */
  if (!(await passkeyOwnerHasAccount(db, outcome.actorId))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_passkey' }, { status: 401 }),
    };
  }

  const account = await accountFor(db, outcome.actorId);
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_passkey' }, { status: 401 }),
    };
  }

  /*
   * Back to an address, so the rest is the code path exactly.
   *
   * It looks like a detour — the passkey already named an actor, and `signIn`
   * is about to look that actor up again from the address. The detour is the
   * point: `signIn` owns creating an account, adopting a stranded one, and the
   * merge, and a passkey branch that repointed `account_id` itself would be a
   * second implementation of the one thing in this system whose incomplete
   * version is silent.
   */
  return { ok: true, email: account.email };
}
