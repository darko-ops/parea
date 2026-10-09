/**
 * The roll comes out of its group.
 *
 * Its creator's to do, or an admin of the group's: a group admin keeps the
 * group's shelf, and its creator decides where their roll lives. Either way
 * the roll stays its creator's, and everybody in the group stays in it — see
 * `takeOutOfGroup` for how, and why it has to be written down rather than left
 * to the group.
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

  // `administer`, which is exactly the two who may: its creator, or an admin
  // of the group it is in.
  try {
    await guard(db, event, 'administer', await requesterFor(id));
  } catch (err) {
    return toResponse(err);
  }

  const carried = await takeOutOfGroup(db, event.id);
  if (carried === null) return NextResponse.json({ error: 'not_in_a_group' }, { status: 409 });
  return NextResponse.json({ ok: true, carried });
}
