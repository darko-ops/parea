/**
 * Register a device for push — docs/design.md §12.
 *
 * Tied to an actor, so it follows the same rule as everything else: no
 * account, and nothing is stored until someone has contributed and has an
 * identity to attach it to.
 *
 * Upserts on the token rather than the device, because a reinstall issues a
 * new token and the old row is dead weight until Expo tells us so.
 */

import { schema } from '@parea/core';
import { isExpoPushToken } from '@parea/push';
import { and, eq, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { currentActorId, currentSessionId } from '@/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    pushToken?: unknown;
    platform?: unknown;
  };

  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const pushToken = typeof body.pushToken === 'string' ? body.pushToken : '';
  if (!isExpoPushToken(pushToken)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }
  const platform = body.platform === 'android' ? 'android' : 'ios';

  const db = getDb();
  const sessionId = await currentSessionId();

  /*
   * One phone, one person to notify.
   *
   * A push token is a phone, and it used to stay registered under every actor
   * that had ever registered it — so a phone signed in to a second account kept
   * getting the first one's notifications. Whoever registers it now is who it
   * belongs to.
   */
  await db
    .delete(schema.devices)
    .where(and(eq(schema.devices.pushToken, pushToken), ne(schema.devices.actorId, actorId)));

  const [existing] = await db
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .where(
      and(
        eq(schema.devices.actorId, actorId),
        eq(schema.devices.pushToken, pushToken),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.devices)
      // The session too: a row from before the column learns its sign-in
      // here, and one whose phone signed in again follows the new session.
      .set({ lastSeenAt: new Date(), sessionId })
      .where(eq(schema.devices.id, existing.id));
    return NextResponse.json({ registered: true });
  }

  await db
    .insert(schema.devices)
    .values({ actorId, platform, pushToken, sessionId, lastSeenAt: new Date() });

  return NextResponse.json({ registered: true }, { status: 201 });
}

/** Turning notifications off, or signing out of a device. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { pushToken?: unknown };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  if (typeof body.pushToken !== 'string') {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  await getDb()
    .delete(schema.devices)
    .where(
      and(
        eq(schema.devices.actorId, actorId),
        eq(schema.devices.pushToken, body.pushToken),
      ),
    );
  return NextResponse.json({ registered: false });
}
