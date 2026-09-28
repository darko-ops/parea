/**
 * That this viewer has opened a moment, so it falls behind the ones they have
 * not. See `orderStream`. Answers the same whether or not the moment exists:
 * this says nothing to anybody, and a 404 would say something.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { markSeen } from '@/moments';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    // A moment that has gone fails the foreign key; that is the same answer.
    await markSeen(getDb(), actorId, id).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
