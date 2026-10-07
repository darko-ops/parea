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

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById } from '@/access';
import { getDb, type Db } from '@/db';
import {
  MAX_BODY,
  groupMessagesFor,
  markGroupThreadRead,
  postGroupMessage,
} from '@/groupMessages';
import { findGroup, membershipOf } from '@/groups';
import { authorOf, canSeeMoment } from '@/moments';
import { currentAccountActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const viewerId = await currentAccountActorId();
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

  const body = (await request.json().catch(() => ({}))) as {
    body?: unknown;
    photoId?: unknown;
    momentId?: unknown;
  };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const photoId = typeof body.photoId === 'string' && UUID.test(body.photoId) ? body.photoId : null;
  const momentId = typeof body.momentId === 'string' && UUID.test(body.momentId) ? body.momentId : null;
  if ((body.photoId != null && !photoId) || (body.momentId != null && !momentId) || (photoId && momentId)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  // Empty is rejected here rather than in the column, because the column has
  // to allow it: deleting a message overwrites the body. A photograph or a
  // moment sent on its own is not empty — the picture is what was said.
  if (!text && !photoId && !momentId) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: 'too_long', max: MAX_BODY }, { status: 400 });
  }

  if (photoId) {
    const refused = await mayShareIntoChat(db, actorId, photoId);
    if (refused) return refused;
  }
  if (momentId) {
    const refused = await mayForwardMoment(db, actorId, momentId, group.id);
    if (refused) return refused;
  }

  const messageId = await postGroupMessage(db, group.id, actorId, text, { photoId, momentId });
  return NextResponse.json({ id: messageId }, { status: 201 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sending a roll's photograph into a chat.
 *
 * The sender has to be able to see it now — the same `view` decision the roll
 * itself makes — and it has to be there to see. Then the question the chat
 * adds: the people in it may not be in the roll. A public roll is open to
 * anyone it reaches, so its photographs may travel. A private one is the
 * people let in, so only the person who took a photograph may send it on;
 * anyone else forwarding it would be choosing, for them, who outside sees it.
 */
async function mayShareIntoChat(db: Db, actorId: string, photoId: string): Promise<Response | null> {
  const [photo] = await db
    .select({
      eventId: schema.photos.eventId,
      uploaderId: schema.photos.uploaderId,
      status: schema.photos.status,
      deletedAt: schema.photos.deletedAt,
      hiddenAt: schema.photos.hiddenAt,
    })
    .from(schema.photos)
    .where(eq(schema.photos.id, photoId))
    .limit(1);
  const gone = NextResponse.json({ error: 'photo_not_found' }, { status: 404 });
  if (!photo || photo.deletedAt || photo.hiddenAt || photo.status !== 'ready') return gone;

  const event = await findEventById(db, photo.eventId);
  if (!event || event.deletedAt) return gone;
  const decision = await decide(db, event, 'view', await requesterFor(event.id));
  if (!decision.allow) return gone;

  if (event.accessPolicy === 'private' && photo.uploaderId !== actorId) {
    return NextResponse.json({ error: 'private_roll' }, { status: 403 });
  }
  return null;
}

/**
 * Sending a moment on into a chat.
 *
 * Your own goes wherever you send it. Somebody else's was shared with their
 * friends, so it may only go to a chat whose every other member could already
 * see it — forwarding it must not show it to anyone its author did not.
 */
async function mayForwardMoment(
  db: Db,
  actorId: string,
  momentId: string,
  groupId: string,
): Promise<Response | null> {
  if (!(await canSeeMoment(db, actorId, momentId))) {
    return NextResponse.json({ error: 'moment_not_found' }, { status: 404 });
  }
  const author = await authorOf(db, momentId);
  if (author === actorId) return null;

  const members = await db
    .select({ actorId: schema.groupMembers.actorId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId));
  for (const m of members) {
    if (m.actorId === actorId || m.actorId === author) continue;
    if (!(await canSeeMoment(db, m.actorId, momentId))) {
      return NextResponse.json({ error: 'not_shareable' }, { status: 403 });
    }
  }
  return null;
}
