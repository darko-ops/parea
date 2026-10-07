/**
 * The × on a "People you may know" card.
 *
 * DELETE because, from where the person pressing it stands, that is what it
 * is: the suggestion goes away. What is written is a dismissal — see
 * `dismissSuggestion` — so the same person does not come back on the next load.
 *
 * Signed in only, like the list it edits: a guest is never shown a suggestion,
 * so a guest has none to dismiss.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { dismissSuggestion } from '@/friends';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ actorId: string }> },
) {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const { actorId: dismissed } = await params;
  if (!UUID.test(dismissed)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (dismissed === actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /*
   * A well-formed id that names nobody fails the foreign key. Answered the same
   * as any other miss rather than as a 500, and without saying whether the id
   * was ever an actor.
   */
  try {
    await dismissSuggestion(db, actorId, dismissed);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ dismissed: true });
}
