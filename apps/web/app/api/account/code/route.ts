/**
 * Ask for a sign-in code — design §3.
 *
 * **Answers the same however it went.** A 204 whether or not the address has
 * an account, whether or not it exists, whether or not the mailer was reached,
 * whether or not that address has already had its share this hour: anything
 * else turns this into a way to ask "does this person use Parea?", which is a
 * question about who was at which party.
 *
 * The one exception is a malformed address, which tells the caller about their
 * own input and nothing about anyone else. The per-source 429 is not an
 * exception either — it describes the caller, who already knows how many
 * requests they have made, and says nothing about any address.
 */

import { newSignInCode, normaliseEmail } from '@parea/core';
import { NextResponse } from 'next/server';

import { storeCode } from '@/accounts';
import { getDb } from '@/db';
import { MailUnavailable, mailerFromEnv, redact, signInEmail } from '@parea/core';
import { SIGN_IN_ADDRESS_LIMIT, SIGN_IN_LIMIT, withinLimit, withinLimitFor } from '@/ratelimit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === 'string' ? normaliseEmail(body.email) : null;
  if (!email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });

  const db = getDb();
  // Sending mail on demand to an arbitrary address is a way to use this
  // deployment to post things to strangers, so it is bounded harder than the
  // rest of the API.
  if (!(await withinLimit(db, SIGN_IN_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  // Bounds what one *address* receives, however many sources ask. Silent, and
  // it stops before storing a code: a row nobody will ever be told about is
  // just a row, and the person being mailed at is not the one making requests.
  if (!(await withinLimitFor(db, SIGN_IN_ADDRESS_LIMIT, secret, email))) {
    return new NextResponse(null, { status: 204 });
  }

  const code = newSignInCode();
  await storeCode(db, secret, email, code);

  const mailer = mailerFromEnv();
  try {
    await mailer.send({ to: email, ...signInEmail(code) });
  } catch (err) {
    // Logged loudly, answered blandly. A mailer outage must not be reported
    // back differently from a working one, or the difference is the oracle
    // this endpoint exists to avoid.
    //
    // The address is kept out of the line. It is the one piece of the failure
    // that says something about a person rather than about the deployment, and
    // logs outlive the ten minutes the code is good for.
    const detail = err instanceof MailUnavailable ? err.message : String(err);
    console.error(`sign-in code not sent via ${mailer.name}: ${redact(detail, email)}`);
  }

  return new NextResponse(null, { status: 204 });
}
