/**
 * Somebody's friends — the list behind the count on their profile.
 *
 * For anybody signed in, as their own is. `profileFor` decides whether the
 * profile is there at all for this reader — a block either way makes it a 404
 * — and `friendsSeenBy` leaves out anybody a block stands between the reader
 * and. Nothing else about the friends goes out: a name, a handle, a face.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { friendsSeenBy } from '@/friends';
import { profileFor } from '@/people';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const db = getDb();
  const actorId = await currentActorId();

  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const person = await profileFor(db, actorId, decodeURIComponent(handle));
  if (!person) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const friends = await friendsSeenBy(db, actorId, person.actorId);
  return NextResponse.json({
    friends: await Promise.all(
      friends.map(async (friend) => ({
        actorId: friend.actorId,
        handle: friend.handle,
        displayName: friend.displayName,
        avatar: await avatarUrl(friend.avatarKey),
      })),
    ),
  });
}
