/**
 * Finding a person by handle.
 *
 * The one place accounts are searchable, and it is deliberately narrow: prefix
 * of a handle, ten results, and nothing about anyone comes back except the
 * handle and the name they chose to show. No events, no photos, no counts, no
 * mutual friends — being findable leads to somebody being able to ask, and to
 * nothing else.
 *
 * Signed in only. An anonymous caller has no reason to enumerate handles, and
 * the rate limit is the floor under how fast a signed-in one can.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { findByPhone, findPeople, looksLikePhone } from '@/friends';
import { PEOPLE_SEARCH_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  // Searching is the one read in this product that walks the account table, so
  // it gets its own ceiling rather than sharing the general one.
  if (!(await withinLimit(db, PEOPLE_SEARCH_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const query = new URL(request.url).searchParams.get('q') ?? '';

  /*
   * A number is an exact lookup, not a search.
   *
   * Somebody typing a phone number is not browsing — they have the number
   * already, which is the whole permission model for this: the number *is* the
   * introduction. So it matches the whole thing or nothing, and there is no
   * prefix, no partial and no "did you mean". A prefix search over phone
   * numbers would be a way to walk the account table ten digits at a time.
   *
   * It answers in the same shape as a handle search — a handle and a name —
   * so a caller cannot tell from the response which door it came through, and
   * a number that matches nobody is simply an empty list.
   */
  if (looksLikePhone(query)) {
    return NextResponse.json({ people: await findByPhone(db, actorId, query) });
  }

  return NextResponse.json({ people: await findPeople(db, actorId, query) });
}
