/**
 * The thread on a group — read it, add to it.
 *
 * One rule, and it is the narrowest the product has: membership. The event
 * thread has two capabilities to weigh because an event has a link-holder who
 * may read without an account; a group has nobody of the kind. So there is no
 * `guard`, no `requesterFor` and no capability here — `membershipOf` decides
 * both directions, and a non-member is told the group is not there rather than
 * that they may not read it.
 *
 * That last part is deliberate and matches the group screen: a 403 on a group
 * you were never in confirms it exists and who is in it, which is exactly the
 * disclosure `findable` is a per-group setting to control.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import {
  MAX_BODY,
  groupMessagesFor,
  markGroupThreadRead,
  postGroupMessage,
} from '@/groupMessages';
import { findGroup, membershipOf } from '@/groups';
import { currentAccountActorId, currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const viewerId = await currentActorId();
  const membership = await membershipOf(db, group.id, viewerId);
  // Not 403. See the note at the top.
  if (!membership) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const messages = await groupMessagesFor(db, group.id, viewerId);

  /*
   * Reading the thread is what marks it read.
   *
   * On the GET rather than behind a second call the client has to remember to
   * make: this route is only ever fetched by something that is about to draw
   * the conversation. The list endpoints do not come through here, so a badge
   * cannot clear itself merely by being counted.
   *
   * Opt out with `?peek=1` for a caller that wants the messages without
   * claiming to have read them.
   */
  const peek = new URL(request.url).searchParams.get('peek') === '1';
  if (viewerId && !peek) await markGroupThreadRead(db, group.id, viewerId);

  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /*
   * An account, not merely a browser.
   *
   * The same rule the event thread posts under, for the same reason: speaking
   * addresses the room, so it requires having said who you are. A guest actor
   * cannot be a group member in any case, which makes this belt and braces —
   * and worth keeping, because the day a guest can be added to a group is the
   * day this is the only thing standing in the way.
   */
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const membership = await membershipOf(db, group.id, actorId);
  if (!membership) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  // Empty is rejected here rather than in the column, because the column has
  // to allow it: deleting a message overwrites the body.
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: 'too_long', max: MAX_BODY }, { status: 400 });
  }

  const messageId = await postGroupMessage(db, group.id, actorId, text);
  return NextResponse.json({ id: messageId }, { status: 201 });
}
