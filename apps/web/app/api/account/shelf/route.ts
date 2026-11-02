/**
 * "Organize Rolls" — PUT saves the order somebody left their profile's shelf
 * in, as `{ order: [eventId, …] }`, first to last.
 *
 * No `guard`, for the reason `events/[id]/participation` has none: this reads
 * no event and no photo. It hands an actor id and a list of ids to
 * `saveShelf`, which writes rows that are that actor's alone and learns of the
 * ids only whether they name a roll.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { SHELF_MAX, saveShelf } from '@/events';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: Request) {
  const actorId = await currentAccountActorId();
  // A shelf is a profile's, and a profile is an account's.
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { order?: unknown } | null;
  const order = body?.order;
  if (
    !Array.isArray(order) ||
    order.length > SHELF_MAX ||
    !order.every((id): id is string => typeof id === 'string' && UUID.test(id))
  ) {
    return NextResponse.json({ error: 'invalid_order' }, { status: 400 });
  }

  await saveShelf(getDb(), actorId, order);
  return new NextResponse(null, { status: 204 });
}
