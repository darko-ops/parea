/**
 * One member's own hold on a room's chat: pinning it, and deleting it.
 *
 * Both are theirs alone. A pin puts the chat at the top of their Chats; a
 * delete clears what has been said for them and takes it off their list until
 * somebody says something new. Neither changes the room, its people, or what
 * anybody else sees — leaving is `members`, and is a different thing.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { clearChat, pinChat } from '@/groups';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{ pinned: boolean }`. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { pinned?: unknown };
  if (typeof body.pinned !== 'boolean') {
    return NextResponse.json({ error: 'pinned_required' }, { status: 400 });
  }
  if (!(await pinChat(getDb(), id, actorId, body.pinned))) {
    return NextResponse.json({ error: 'not_member' }, { status: 404 });
  }
  return NextResponse.json({ pinned: body.pinned });
}

/** Deletes the chat for this member. See `clearChat`. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!(await clearChat(getDb(), id, actorId))) {
    return NextResponse.json({ error: 'not_member' }, { status: 404 });
  }
  return NextResponse.json({ cleared: true });
}
