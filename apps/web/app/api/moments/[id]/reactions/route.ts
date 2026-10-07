/**
 * Reacting to a moment: on if it was off, off if it was on — the same toggle
 * a roll's photographs use, and any emoji rather than a fixed six (see
 * `isEmoji`). Only for somebody who can see the moment.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { canSeeMoment, replyInChat, toggleMomentReaction } from '@/moments';
import { nameOf, notifyMomentReaction } from '@/notify';
import { isEmoji } from '@/reactions';
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

  const body = (await request.json().catch(() => ({}))) as { emoji?: unknown };
  if (!isEmoji(body.emoji)) {
    return NextResponse.json({ error: 'not_an_emoji' }, { status: 400 });
  }

  const db = getDb();
  if (!(await canSeeMoment(db, actorId, id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const emoji = body.emoji;
  const state = await toggleMomentReaction(db, actorId, id, emoji);

  /*
   * Put on, it is also said to the author — the emoji as a message in the two
   * people's chat, with the moment beside it — and the push points there.
   * Taken off, nothing: a message saying somebody changed their mind is
   * noise. Never for the author reacting to their own.
   */
  if (state === 'added') {
    const reply = await replyInChat(db, actorId, id, { body: emoji, emoji });
    if (reply) {
      void nameOf(db, actorId).then((who) =>
        notifyMomentReaction(db, { toActorId: reply.toActorId, groupId: reply.groupId, momentId: id, who, emoji }),
      );
    }
  }
  return NextResponse.json({ state });
}
