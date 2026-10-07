/** Taking back something you said under a moment. Yours only. */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { removeMomentComment } from '@/moments';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { commentId } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(commentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const gone = await removeMomentComment(getDb(), actorId, commentId);
  if (!gone) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
