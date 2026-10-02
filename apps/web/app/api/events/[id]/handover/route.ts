/**
 * The roll's Host hands it to somebody else.
 *
 * `{ actorId }`, somebody already in the roll. The rules — who may hand it on,
 * to whom, and what the giver keeps — are `handOverRoll`'s, in `@/succession`,
 * next to the rule for choosing an heir when the Host goes without saying.
 *
 * A roll the reader is not Host of is a 404, the same answer `administer`
 * routes give, rather than a 403 that confirms the roll exists.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { notifyRollHanded } from '@/notify';
import { currentAccountActorId } from '@/session';
import { handOverRoll } from '@/succession';

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

  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const outcome = await handOverRoll(getDb(), id, actorId, body.actorId);
  switch (outcome) {
    case 'handed_over':
      await notifyRollHanded(getDb(), [{ id, actorId: body.actorId }], actorId);
      return NextResponse.json({ ok: true, hostActorId: body.actorId });
    case 'not_yours':
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    default:
      return NextResponse.json({ error: outcome }, { status: 409 });
  }
}
