/**
 * Reacting to a message in a group.
 *
 * The mirror of `/api/messages/[id]/reactions`, with one rule where that one
 * has a capability to weigh: membership. A group has no link-holder and no
 * anonymous reader, so there is nothing to separate reading from reacting —
 * being in the room is the whole of it, and `membershipOf` answers in both
 * directions.
 *
 * Its own path rather than a branch inside the event one: the ids come from
 * different tables and could collide, and a route that has to guess which
 * table an id belongs to is a route that can be asked to guess wrong.
 *
 * One verb, because the control is one pill: POST toggles and the response
 * says which way it went. Separate add and remove routes would mean the client
 * has to know which state it is in before it can act, and with two screens
 * open on one conversation it does not.
 *
 * Everything not allowed answers 404, including "in the group yesterday".
 * Distinguishing them would make this a way to ask whether a message id is
 * real — the same reasoning as the edit and delete route beside it.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { groupOfMessage, toggleGroupReaction } from '@/groupMessages';
import { membershipOf } from '@/groups';
import { LIKE } from '@/reactions';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const groupId = await groupOfMessage(db, id);
  if (!groupId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /*
   * An account, not an actor.
   *
   * A reaction is attributed and counted and shown to everybody in the room,
   * which is the same standard as posting — and in a group there is no such
   * thing as a guest anyway, so `currentActorId` would only ever answer for
   * somebody who cannot be a member.
   */
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const membership = await membershipOf(db, groupId, actorId);
  // Not 403. See the note at the top.
  if (!membership) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // A like, whatever was asked for. See `LIKE`.
  const emoji = LIKE;
  const state = await toggleGroupReaction(db, id, actorId, emoji);
  return NextResponse.json({ state });
}
