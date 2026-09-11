/**
 * One message in a group — rewrite it, or take it back.
 *
 * The mirror of `/api/messages/[id]`, and it makes the same two checks in the
 * same order: find the room the message is in, ask whether the caller may see
 * that room, and only then ask whether the row is theirs. Ownership without
 * access is the bug that order exists to prevent — somebody removed from a
 * group still owns the messages they left in it.
 *
 * Its own path rather than a branch inside `/api/messages/[id]`: the ids come
 * from different tables and could collide, and a route that has to guess which
 * table an id belongs to is a route that can be asked to guess wrong.
 *
 * Everything not allowed answers 404, including "yours, but you are no longer
 * in the group". Distinguishing them would make this a way to ask whether a
 * message id is real.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import {
  MAX_BODY,
  deleteGroupMessage,
  editGroupMessage,
  groupOfMessage,
} from '@/groupMessages';
import { membershipOf } from '@/groups';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

/** The common preamble: which group, am I in it, and is this mine to change. */
async function mine(messageId: string) {
  const db = getDb();
  const groupId = await groupOfMessage(db, messageId);
  if (!groupId) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  // Only an account can have written one, so only an account can change one.
  const actorId = await currentAccountActorId();
  if (!actorId) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  // Access before ownership. `editGroupMessage` and `deleteGroupMessage` both
  // carry the authorship check in their own WHERE, so this is the half that
  // would otherwise be missing.
  const membership = await membershipOf(db, groupId, actorId);
  if (!membership) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  return { db, actorId };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const checked = await mine(id);
  if ('error' in checked) return checked.error;

  const body = (await request.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: 'too_long', max: MAX_BODY }, { status: 400 });
  }

  // False here means the row is not this actor's, or is already a tombstone.
  const changed = await editGroupMessage(checked.db, id, checked.actorId, text);
  if (!changed) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const checked = await mine(id);
  if ('error' in checked) return checked.error;

  const removed = await deleteGroupMessage(checked.db, id, checked.actorId);
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
