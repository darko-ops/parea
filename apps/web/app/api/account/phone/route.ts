/**
 * The number people can find you by: asking for it, and taking it back.
 *
 * POST starts a verification and DELETE removes the number. Neither ever stores
 * the digits: what lands in a row is the keyed hash and the last two digits.
 * See `phone.ts` for why, and for the one honest caveat — the digits are
 * *sent*, they are just not kept.
 *
 * ## Why this used to be a PATCH and is not any more
 *
 * It was one request that set the column. That was wrong in a way nothing in
 * the product could see: a hash says two people typed the same digits and
 * nothing about whose digits they are, so a form that writes the column
 * directly is a form anybody can fill with somebody else's number. The person
 * harmed is the one who owns it — they are not here, they never touched the
 * product, and the first they would know of it is a stranger's account coming
 * back when a friend looked them up.
 *
 * So the number is proved before it counts. POST sends a code to it and writes
 * nothing to the actor; `POST /api/account/phone/verify` is what sets the
 * column, and `findByPhone` matches on `phone_verified_at` rather than on the
 * hash alone. A number that was set under the old route is still in the column
 * and is no longer proved, which means it stops making anybody findable until
 * they enter it again — the right way round for a claim nobody ever checked.
 *
 * An account, not a browser. A phone number attached to a guest actor would be
 * a number attached to whoever next picks up that laptop, and the whole point
 * of the column is that it names one person.
 */

import {
  newSignInCode,
  redactNumber,
  schema,
  TextUnavailable,
  texterFromEnv,
  UnconfiguredTexter,
  verifyText,
} from '@parea/core';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { lastTwo, normalisePhone, startVerification, textableCountry } from '@/phone';
import {
  PHONE_ACCOUNT_LIMIT,
  PHONE_CODE_LIMIT,
  PHONE_DAILY_LIMIT,
  PHONE_NUMBER_LIMIT,
  withinLimit,
  withinLimitFor,
} from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

async function me() {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) return null;
  return { db, actorId };
}

/**
 * Send a code to a number, and write down what it would claim.
 *
 * Answers `{ sent: true }` whatever happened after the number parsed — a
 * carrier outage, a number that has had its share of texts this hour, a number
 * another account already holds. The first two for the reason the sign-in route
 * answers 204 however it went: a distinguishable failure is an oracle, and here
 * the question it would answer is "has somebody been asked about this number?".
 *
 * The one exception is a deployment with no carrier configured, which answers
 * 503 and says so. That is a fact about this deployment rather than about any
 * number, so it is no oracle — and the alternative is a screen waiting forever
 * for a text nothing exists to send.
 *
 * The third — a number another account already holds — is the interesting one,
 * and it is deliberately *not* refused here. Checking it now would turn this
 * endpoint into a way to ask "does this number have a Parea account?", which is
 * a question about who was at which party, asked by anybody with a keypad. The
 * unique index is what decides, and it decides at `verify` — where the caller
 * has already proved the number is theirs and is entitled to be told that
 * somebody else got there first.
 */
export async function POST(request: Request) {
  const session = await me();
  if (!session) return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  const e164 = typeof body.phone === 'string' ? normalisePhone(body.phone) : null;
  if (!e164) {
    // Named, because the rule is not obvious and "invalid" would send somebody
    // to re-type the same thing: it is the country code that is missing.
    return NextResponse.json({ error: 'needs_country_code' }, { status: 400 });
  }

  // Only to the countries this service texts — see `textableCountry`.
  if (!textableCountry(e164)) {
    return NextResponse.json({ error: 'country_not_supported' }, { status: 400 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  // Sending a text on demand to a number the caller chose is a way to spend
  // this deployment's money on waking strangers' phones up, so it is bounded
  // harder than the rest of the API and in two directions.
  if (
    !(await withinLimit(session.db, PHONE_CODE_LIMIT, secret)) ||
    !(await withinLimitFor(session.db, PHONE_ACCOUNT_LIMIT, secret, session.actorId))
  ) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  /*
   * The daily ceiling for everybody together. Tripping it is either a very good
   * day or an attack, and both are worth hearing about — so it tells Sentry,
   * and texting pauses until the window rolls over.
   */
  if (!(await withinLimitFor(session.db, PHONE_DAILY_LIMIT, secret, 'all'))) {
    Sentry.captureMessage('Phone verification texts hit the daily ceiling', {
      level: 'error',
      tags: { kind: 'sms_ceiling' },
    });
    return NextResponse.json({ error: 'try_later' }, { status: 503 });
  }

  /*
   * Bounds what one *number* receives, however many callers ask about it.
   *
   * Silent, and it stops before writing a row: the person being texted is not
   * the one making requests, and telling the caller they have hit a per-number
   * cap would tell them the number has been asked about before.
   *
   * The number goes in as the subject and comes out as an HMAC — see
   * `withinLimitFor`, which hashes it into a bucket name. It is not written
   * down here any more than anywhere else.
   */
  if (!(await withinLimitFor(session.db, PHONE_NUMBER_LIMIT, secret, e164))) {
    return NextResponse.json({ sent: true, last2: lastTwo(e164) });
  }

  /*
   * A deployment with no carrier says so, before a row is written.
   *
   * The only difference this endpoint is allowed to report, and it is allowed
   * because it is a fact about the deployment rather than about the number: no
   * caller learns anything about anybody from it. Every other failure below is
   * swallowed for exactly the opposite reason.
   *
   * Worth the four lines because of what silence costs here. The alternative is
   * a screen that says "we sent a code to the number ending 77" and then waits
   * for a text that no configuration exists to send — which looks like a phone
   * on a bad network rather than like a deployment that is not finished.
   */
  const texter = texterFromEnv();
  if (texter instanceof UnconfiguredTexter) {
    console.error('phone code not sent: no texter configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const code = newSignInCode();
  await startVerification(session.db, secret, session.actorId, e164, code);

  try {
    await texter.send({ to: e164, body: verifyText(code) });
  } catch (err) {
    /*
     * Logged loudly, answered blandly — and logged without the number.
     *
     * A carrier's rejection quotes the recipient back verbatim, so an unredacted
     * line here would put a phone number in the one place nobody thinks to look
     * for one, and logs outlive the ten minutes the code is good for.
     */
    const detail = err instanceof TextUnavailable ? err.message : String(err);
    console.error(`phone code not sent via ${texter.name}: ${redactNumber(detail, e164)}`);
  }

  // The two digits come back so the screen can say which number it texted,
  // which is the one thing somebody who mistyped needs in order to notice.
  return NextResponse.json({ sent: true, last2: lastTwo(e164) });
}

/**
 * Give the number back.
 *
 * Clears all three columns. `phone_verified_at` has to go with the other two or
 * a number entered afterwards would arrive pre-proved — the timestamp would be
 * standing from the last one, and every lookup reads it.
 *
 * `discoverable` is deliberately left alone. It is a preference about being
 * found, not a property of the number: somebody who removes a number and adds
 * another later meant one thing by that, and silently flipping a switch they set
 * on purpose is not it.
 */
export async function DELETE() {
  const session = await me();
  if (!session) return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });

  await session.db
    .update(schema.actors)
    .set({ phoneHash: null, phoneLast2: null, phoneVerifiedAt: null })
    .where(eq(schema.actors.id, session.actorId));

  return new NextResponse(null, { status: 204 });
}
