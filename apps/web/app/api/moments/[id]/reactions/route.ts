/**
 * Reacting to a moment: on if it was off, off if it was on — the same toggle
 * a roll's photographs use, and any emoji rather than a fixed six (see
 * `isEmoji`). Only for somebody who can see the moment.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { authorOf, canSeeMoment, toggleMomentReaction } from '@/moments';
import { nameOf, notifyMomentReaction } from '@/notify';
import { isEmoji } from '@/reactions';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
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

  // Told when one is put on, not when it comes off; never about your own.
  if (state === 'added') {
    const author = await authorOf(db, id);
    if (author && author !== actorId) {
      void nameOf(db, actorId).then((who) =>
        notifyMomentReaction(db, { toActorId: author, momentId: id, who, emoji }),
      );
    }
  }
  return NextResponse.json({ state });
}
