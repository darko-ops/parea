/**
 * Report a photo to us — docs/design.md §13.
 *
 * Deliberately not routed to the host: for abuse, the host may be the problem,
 * and a reporting channel that ends at the person you are reporting is not a
 * reporting channel. This lands in a queue a human reads.
 *
 * No SLA is promised in the response, because none can currently be kept.
 */

import { schema } from '@parea/core';
import { NextResponse } from 'next/server';

import { guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { findPhotoWithEvent } from '@/moderation';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const KINDS = new Set(['abuse', 'other']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    note?: unknown;
  };
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'abuse';

  const db = getDb();
  const found = await findPhotoWithEvent(db, id);
  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(found.event.id);
  try {
    await guard(db, found.event, 'view', requester);
  } catch (err) {
    return toResponse(err);
  }

  await db.insert(schema.reports).values({
    photoId: id,
    reporterActorId: await currentActorId(),
    kind: kind as 'abuse' | 'other',
    note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null,
  });

  return NextResponse.json({ reported: true });
}
