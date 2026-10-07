/**
 * Saying something under a moment.
 *
 * Only somebody who can see the moment may comment on it — the stream's own
 * audience rule, asked through `canSeeMoment`, so a moment id somebody was
 * never shown answers the same as one that does not exist.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { COMMENT_MAX, canSeeMoment, commentOnMoment, replyInChat } from '@/moments';
import { nameOf, notifyMomentComment } from '@/notify';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > COMMENT_MAX) {
    return NextResponse.json({ error: 'too_long' }, { status: 400 });
  }

  const db = getDb();
  if (!(await canSeeMoment(db, actorId, id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const commentId = await commentOnMoment(db, actorId, id, text);

  /*
   * And it is said to its author: the same words, as a message in the two
   * people's chat, with the moment beside it. The push points there. Nothing
   * for the author commenting on their own.
   */
  const reply = await replyInChat(db, actorId, id, { body: text });
  if (reply) {
    void nameOf(db, actorId).then((who) =>
      notifyMomentComment(db, { toActorId: reply.toActorId, groupId: reply.groupId, momentId: id, who, said: text }),
    );
  }
  return NextResponse.json({ id: commentId });
}
