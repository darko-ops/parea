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
import {
  findByEmail,
  findByPhone,
  findPeople,
  looksLikeEmail,
  looksLikePhone,
} from '@/friends';
import { profileFor } from '@/people';
import { PEOPLE_SEARCH_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';

/**
 * How many faces one `handles=` call will answer for.
 *
 * The same ceiling the recent list keeps — see `RECENT_MAX` in `FindView` —
 * because that list is the only caller and a request for more than it can hold
 * is a request for somebody else's reason.
 */
const FACES_MAX = 10;

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

  const params = new URL(request.url).searchParams;

  /*
   * Faces for handles somebody already has.
   *
   * The recent list is kept in a browser and holds a handle and a name, never
   * a picture: an avatar URL is presigned for an hour, so one stored there
   * would be a broken image by tomorrow. That was the reason those rows drew a
   * letter, and it is a reason not to *store* a URL rather than a reason not to
   * show a face — so the list asks for fresh ones when it draws.
   *
   * `profileFor` and not a query of its own, because that is where "who may see
   * this person" is decided: a blocked account, a merged one, a handle that
   * never existed and a device that never signed in all come back the same
   * nothing here as they do on `/u/<handle>` and on `/api/people/<handle>`.
   * A face is not a door this can open that the profile would not.
   */
  const asked = params.get('handles');
  if (asked !== null) {
    const wanted = [
      ...new Set(
        asked
          .split(',')
          .map((handle) => handle.trim().toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, FACES_MAX);

    const found = await Promise.all(
      wanted.map(async (handle) => {
        const person = await profileFor(db, actorId, handle);
        if (!person) return null;
        return {
          handle: person.handle,
          name: person.displayName,
          // Presigned here, the key dropped — the boundary every picture in
          // this product crosses.
          avatar: await avatarUrl(person.avatarKey),
        };
      }),
    );

    // Silently short where somebody has gone: the caller is drawing rows it
    // already has names for, and a missing face is a letter rather than a gap.
    return NextResponse.json({ people: found.filter((person) => person !== null) });
  }

  const query = params.get('q') ?? '';

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

  /*
   * An address is the same kind of lookup as a number, and it is here because
   * the setting promises it.
   *
   * "Let people who have my phone number or email find me on Parea" was half a
   * sentence while an address matched nothing: somebody could turn the switch off
   * and the only thing it retracted was the number. Exact and whole, for the
   * number's reason — possession of the address is the introduction, and a prefix
   * over that column would be a way to read the account table.
   *
   * A handle cannot contain an `@`, so nothing is taken away from the search
   * below: there was no query that used to find somebody by handle and now does
   * not.
   */
  if (looksLikeEmail(query)) {
    return NextResponse.json({ people: await seen(await findByEmail(db, actorId, query)) });
  }

  return NextResponse.json({ people: await seen(await findPeople(db, actorId, query)) });
}
