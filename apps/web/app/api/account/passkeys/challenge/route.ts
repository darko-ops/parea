/**
 * What the browser needs to sign in with a passkey — design §3.
 *
 * Unauthenticated, and it has to be: the whole point of a discoverable
 * credential is that nobody says who they are first. There is no address in
 * the request and no address in the response.
 *
 * ## It answers the same to everybody, because it knows nothing
 *
 * `/api/account/code` has to work hard to avoid being a way to ask "does this
 * person use Parea?" — it answers 204 however it went, because the address in
 * the request is a question about a person. This route has no such problem to
 * solve: it is handed nothing and it replies with a random challenge, so there
 * is nothing for the answer to leak. The same response goes to a member and to
 * a stranger because it is the same response.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { authenticationOptions } from '@/passkeys';
import { PASSKEY_CHALLENGE_LIMIT, withinLimit } from '@/ratelimit';
import { requestHost } from '@/session';

export const runtime = 'nodejs';

export async function POST() {
  const db = getDb();
  // Bounds rows, not guesses. See the note on the limit: there is nothing to
  // brute-force here, and the table is what needs a ceiling.
  if (!(await withinLimit(db, PASSKEY_CHALLENGE_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  return NextResponse.json(await authenticationOptions(db, await requestHost()));
}
