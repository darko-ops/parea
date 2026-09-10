/**
 * Finding a person by handle.
 *
 * The one place accounts are searchable, and it is deliberately narrow: prefix
 * of a handle, ten results, and nothing about anyone comes back except the
 * handle, the name they chose to show and their picture. No events, no photos,
 * no counts, no mutual friends — being findable leads to somebody being able
 * to ask, and to nothing else.
 *
 * The picture is new and is the same disclosure the name is: it is what
 * somebody chose to be seen as, and it is already on their profile to anybody
 * who can reach it. What it buys is recognition — a row of handles makes
 * somebody read a list where a face would have been picked out of it — which
 * matters most in the two pickers that ask "who is this album for".
 *
 * Signed in only. An anonymous caller has no reason to enumerate handles, and
 * the rate limit is the floor under how fast a signed-in one can.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
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
  /*
   * Presigned here, the key dropped rather than sent beside it — the same
   * boundary every picture in this product crosses. Ten at most, so this is
   * ten signatures and no round trips.
   */
  const seen = async (people: Awaited<ReturnType<typeof findPeople>>) =>
    Promise.all(
      people.map(async (person) => ({
        ...person,
        avatarKey: undefined,
        avatar: await avatarUrl(person.avatarKey),
      })),
    );

  if (looksLikePhone(query)) {
    return NextResponse.json({ people: await seen(await findByPhone(db, actorId, query)) });
  }

  return NextResponse.json({ people: await seen(await findPeople(db, actorId, query)) });
}
