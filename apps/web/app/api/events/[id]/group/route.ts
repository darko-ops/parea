/**
 * The roll comes out of its group.
 *
 * Its creator's alone. A group admin runs the rolls in a group in every other
 * way, but this one decides where somebody's roll lives and who it is shared
 * with from now on, and that is the person who made it. Everybody in the group
 * stays in the roll — see `takeOutOfGroup` for how, and why it has to be
 * written down rather than left to the group.
 *
 * A roll the reader did not make is a 404, the answer the other creator-only
 * routes give, rather than a 403 that confirms the roll exists.
 */

import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { takeOutOfGroup } from '@/groups';
import { requesterFor } from '@/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Running it at all first — deleted, signed out and strangers answered the
  // way every roll route answers them — and then making it, which is narrower.
  const requester = await requesterFor(id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }
  if (requester.actorId !== event.createdBy) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const carried = await takeOutOfGroup(db, event.id);
  if (carried === null) return NextResponse.json({ error: 'not_in_a_group' }, { status: 409 });
  return NextResponse.json({ ok: true, carried });
}
