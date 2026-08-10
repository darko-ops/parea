/**
 * Mint a guest identity for a client without cookies — design §3.
 *
 * The web gets its actor from a Set-Cookie on first contribution. Native has
 * no equivalent, so it asks for the same signed value and keeps it in the
 * keychain.
 *
 * Still minted on first *contribution*, not first launch: the mobile client
 * calls this the first time someone adds photos, so opening an event you were
 * sent creates no durable record of you.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { actorToken, currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { displayName?: unknown };
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : null;

  const db = getDb();

  const existing = await currentActorId();
  if (existing) {
    // A name given now is a rename, not a no-op. The profile tab is the only
    // place someone can set one after the fact, and this used to answer with
    // the token and quietly discard it.
    if (displayName) {
      await db
        .update(schema.actors)
        .set({ displayName })
        .where(eq(schema.actors.id, existing));
    }
    return NextResponse.json({ actorToken: actorToken(existing) });
  }

  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName })
    .returning();

  return NextResponse.json({ actorToken: actorToken(actor!.id) }, { status: 201 });
}
