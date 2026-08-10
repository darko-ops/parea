/**
 * Deleting an account — App Store Guideline 5.1.1(v), and design §3.
 *
 * Not optional: an app that lets someone create an account has to let them
 * delete it from inside the app. Two separate things are offered, because
 * conflating them takes away other people's copies of an evening they were
 * also at:
 *
 *   DELETE                 the account — the address, and the link between it
 *                          and this person's devices. Their uploads stay, and
 *                          they stay theirs: the actor reverts to a guest and
 *                          can still remove any photo one at a time.
 *   DELETE ?photos=1       the above, and tombstones everything they uploaded.
 *
 * The UI puts both in front of someone rather than choosing for them.
 */

import { NextResponse } from 'next/server';

import { deleteAccount, deleteEverything } from '@/accounts';
import { getDb } from '@/db';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function DELETE(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const alsoPhotos = new URL(request.url).searchParams.get('photos') === '1';

  // Photos first: doing it after the account is gone would leave a window in
  // which a crash loses the request entirely, and the person believes their
  // photos went with their account.
  const photos = alsoPhotos ? await deleteEverything(db, actorId) : 0;
  const deleted = await deleteAccount(db, actorId);

  return NextResponse.json({ deleted, photos });
}
