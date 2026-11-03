/**
 * Which of your contacts are already on Parea.
 *
 * The app sends the numbers in its address book, in full international form,
 * and gets back the people among them who can be found by their number — see
 * `findContacts` for whose, and for what happens to the rest, which is
 * nothing: the numbers are hashed, compared and dropped. Not written, not
 * logged; a request body is not a record.
 *
 * Signed in, and bounded twice: `MAX_CONTACT_NUMBERS` per request and
 * `CONTACTS_MATCH_LIMIT` per account, because a door that answers "is this
 * number here" thousands at a time is otherwise a way to ask it about anyone.
 *
 * POST rather than GET so the numbers are never in a URL, which is the one
 * place every proxy and access log writes down.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { findContacts, MAX_CONTACT_NUMBERS } from '@/friends';
import { CONTACTS_MATCH_LIMIT, withinLimitFor } from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { numbers?: unknown } | null;
  const numbers = Array.isArray(body?.numbers)
    ? body.numbers.filter((n): n is string => typeof n === 'string')
    : null;
  if (!numbers || numbers.length > MAX_CONTACT_NUMBERS) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  if (!(await withinLimitFor(db, CONTACTS_MATCH_LIMIT, process.env.SESSION_SECRET, actorId))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const matches = await findContacts(db, actorId, numbers);
  return NextResponse.json({
    people: await Promise.all(
      matches.map(async ({ avatarKey, ...person }) => ({
        ...person,
        // Presigned here and the key dropped — the boundary every picture crosses.
        avatar: await avatarUrl(avatarKey),
      })),
    ),
  });
}
