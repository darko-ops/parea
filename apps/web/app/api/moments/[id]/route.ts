/**
 * Taking a moment back. Yours only, no confirmation, no reason asked — the
 * same as removing your own photograph from a roll.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { removeMoment } from '@/moments';
import { currentAccountActorId } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const removed = await removeMoment(getDb(), actorId, id);
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // The object goes too: an unreferenced one is never read again.
  await getStorage().delete(removed.key).catch(() => {});
  if (removed.thumbKey) await getStorage().delete(removed.thumbKey).catch(() => {});
  return NextResponse.json({ ok: true });
}
