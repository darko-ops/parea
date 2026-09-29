/**
 * Saying something under a moment.
 *
 * Only somebody who can see the moment may comment on it — the stream's own
 * audience rule, asked through `canSeeMoment`, so a moment id somebody was
 * never shown answers the same as one that does not exist.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { COMMENT_MAX, canSeeMoment, commentOnMoment } from '@/moments';
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
  return NextResponse.json({ id: await commentOnMoment(db, actorId, id, text) });
}
