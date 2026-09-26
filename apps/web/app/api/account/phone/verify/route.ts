/**
 * Presenting the code that was texted, which is what actually claims a number.
 *
 * Its own route rather than a second verb on `../phone`, for the reason the
 * sign-in pair is split: sending and presenting are different budgets, they
 * fail for different reasons, and the one that costs money per call should not
 * share a rate limit with the one that costs nothing. See `PHONE_VERIFY_LIMIT`.
 *
 * ## What the code is presented *against*
 *
 * Only the newest outstanding row for this actor, and the row carries the
 * number — as a hash and two digits, never as digits. The request body is a
 * code and nothing else: a body carrying the number as well would mean the
 * server matching two things a caller supplied against each other, which proves
 * nothing, and would put the digits on the wire a second time for no reason.
 *
 * ## Why this is the one place `discoverable` is written
 *
 * A number arrives here because somebody typed it into a screen whose entire
 * offer was "this is how people who have your number find you". Storing it and
 * then leaving discovery off would be the flow not doing the thing it said. So
 * the switch is turned on with the number — once, on the request that proves it
 * — and the settings screen is where it can be turned off again. It is never
 * written back to true by anything else; a person who turns it off and verifies
 * a new number later has said what they want, and this must not overrule it.
 */

import { normaliseSignInCode, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { confirmVerification } from '@/phone';
import { PHONE_VERIFY_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/** What each refusal is called, and what a screen should say about it. */
const WHY: Record<string, string> = {
  no_code: 'Ask for a new code — there is nothing waiting to be checked.',
  expired: 'That code has expired. Codes last ten minutes; ask for another.',
  wrong: 'That code did not match. Check the text and try again.',
  too_many: 'Too many wrong tries against that code. Ask for a new one.',
};

export async function POST(request: Request) {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === 'string' ? normaliseSignInCode(body.code) : null;
  // Forgiving about spaces and dashes, because people paste out of a message.
  if (!code) {
    return NextResponse.json(
      { error: 'invalid_code', message: 'A code is six digits.' },
      { status: 400 },
    );
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  // One source spraying guesses across many codes is what this bounds. Guessing
  // one code is bounded better, on the row, by `MAX_PHONE_ATTEMPTS`.
  if (!(await withinLimit(db, PHONE_VERIFY_LIMIT, secret))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const check = await confirmVerification(db, secret, actorId, code);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.reason, message: WHY[check.reason] },
      { status: check.reason === 'too_many' ? 429 : 400 },
    );
  }

  try {
    await db
      .update(schema.actors)
      .set({
        phoneHash: check.phoneHash,
        phoneLast2: check.phoneLast2,
        phoneVerifiedAt: new Date(),
        /*
         * And the switch the flow promised, in the same statement.
         *
         * The screen that asked for this number said, in so many words, that
         * adding it is how people who have it find you. Storing the number and
         * leaving discovery off would be the flow not doing the thing it
         * offered, which is why the column defaults false and this is what
         * turns it on.
         *
         * `case` rather than a flat `true`, and the condition is read from the
         * row as it stands *before* this update: only a first proof flips it.
         * Somebody who turned the switch off and then re-entered the same
         * number has said what they want, and a flat `true` would overrule them
         * silently every time.
         *
         * In this statement rather than a second one for the ordinary reason —
         * two statements can half-apply, and the half that lands would be a
         * number stored under a preference nobody chose.
         */
        discoverable: sql`case when ${schema.actors.phoneVerifiedAt} is null then true else ${schema.actors.discoverable} end`,
      })
      .where(eq(schema.actors.id, actorId));
  } catch {
    /*
     * The unique index on `phone_hash`.
     *
     * Two accounts cannot hold one number, because "find by number" would then
     * have two answers and no way to choose — and because a number somebody
     * else already holds is usually a number they still have.
     *
     * Told here and nowhere earlier. At this point the caller has read a code
     * off the phone that owns the number, so they are entitled to know that
     * another account got there first; the send endpoint deliberately does not
     * check, because checking there would answer "does this number have an
     * account?" for anybody with a keypad.
     *
     * Caught rather than checked first: a select-then-update has a gap between
     * the two, and the index is the thing that actually decides.
     */
    return NextResponse.json(
      {
        error: 'already_claimed',
        message: 'Another Parea account already has that number.',
      },
      { status: 409 },
    );
  }

  /*
   * The two digits back, so the screen can say which number it is.
   *
   * `discoverable` is not echoed. The client reads it from the account payload
   * along with every other setting, and a second source for one switch is how
   * two screens come to disagree about whether it is on.
   */
  return NextResponse.json({ last2: check.phoneLast2, verified: true });
}
