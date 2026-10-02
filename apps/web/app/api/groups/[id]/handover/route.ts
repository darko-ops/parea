/**
 * A group's admin makes another member its admin, and steps down.
 *
 * `{ actorId }`, somebody in the group. The rules are `handOverGroup`'s, in
 * `@/succession`, next to the rule for choosing an admin when the last one
 * leaves without saying.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { notifyGroupHanded } from '@/notify';
import { currentActorId } from '@/session';
import { handOverGroup } from '@/succession';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { actorId?: unknown };
  // Shaped like an id, so a typo is a 400 rather than Postgres refusing the cast.
  if (typeof body.actorId !== 'string' || !UUID.test(body.actorId)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const outcome = await handOverGroup(getDb(), id, actorId, body.actorId);
  switch (outcome) {
    case 'handed_over':
      await notifyGroupHanded(getDb(), [{ id, actorId: body.actorId }], actorId);
      return NextResponse.json({ ok: true, adminActorId: body.actorId });
    case 'not_yours':
      return NextResponse.json({ error: 'not_admin' }, { status: 403 });
    default:
      return NextResponse.json({ error: outcome }, { status: 409 });
  }
}
