/**
 * Taking somebody out of a roll — `DELETE ?actorId=`, from the People tab.
 *
 * The owner's counterpart to `participation`, which is somebody leaving: a
 * different path because it is a different question. That one needs nothing
 * but being the person; this one is one person deciding about another, and
 * needs `administer` — whoever made the roll, or an admin of its group.
 *
 * Private rolls only. On a public one being a member is not what lets anybody
 * see it — they can open it from a profile or the link as anybody can — so a
 * Remove there would report something that did not happen. What is taken, and
 * what is left, is argued in `removeFromEvent`.
 */

import { PRIVATE } from '@parea/core';
import { NextResponse } from 'next/server';

import { decide, findEventById } from '@/access';
import { getDb } from '@/db';
import { removeFromEvent } from '@/events';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = new URL(request.url).searchParams.get('actorId');
  if (!target) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return notFound();

  const actorId = await currentActorId();
  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow || !actorId) return notFound();

  if (event.accessPolicy !== PRIVATE) {
    return NextResponse.json({ error: 'public_roll' }, { status: 409 });
  }

  const result = await removeFromEvent(db, event, target, actorId);
  if (result.removed) return NextResponse.json({ removed: true });
  // Already out — by leaving, or another tab getting there first.
  if (result.reason === 'not_in') return notFound();
  return NextResponse.json({ error: result.reason }, { status: 409 });
}
