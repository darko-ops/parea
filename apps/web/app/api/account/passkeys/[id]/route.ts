/**
 * Removing a passkey.
 *
 * Removing the last one is allowed, and that is a decision rather than an
 * omission. Refusing would be a product that can trap somebody: a key on a
 * phone they have just sold is exactly the one they most need to remove, and
 * "you cannot, it is your only one" is the wrong answer when a code to their
 * inbox still gets them in. The code path is never taken away, so there is no
 * such thing as removing the last way in.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { removePasskey } from '@/passkeys';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  // False for a key that is not theirs and for one that never existed — the
  // same answer, which is what keeps this from being a way to ask whether an
  // id is somebody's.
  const removed = await removePasskey(getDb(), actorId, id);
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
