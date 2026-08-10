/**
 * "That's a photo of me, please take it down" — docs/design.md §13.
 *
 * Available to anyone who can see the photo, with no account, because the
 * person in a photo is frequently not the person who uploaded it and may not
 * be a member of anything. Requiring identity here would mean the people with
 * the strongest claim have the least standing to make it.
 *
 * Routes to the host, with a 48-hour auto-hide if unanswered. Hosts are
 * ordinary people who may not open the app for a week, so "wait for the host"
 * cannot be the whole answer — but the host keeps the ability to decline, and
 * the photo comes back if they do.
 */

import { autoHideDeadline, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { findPhotoWithEvent } from '@/moderation';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { note?: unknown };

  const db = getDb();
  const found = await findPhotoWithEvent(db, id);
  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(found.event.id);
  try {
    // Seeing the photo is the bar. Anyone who can see it can ask about it.
    await guard(db, found.event, 'view', requester);
  } catch (err) {
    return toResponse(err);
  }

  const actorId = await currentActorId();

  // One open request per photo per person, so repeated taps do not stack up
  // deadlines or spam the host.
  const [existing] = await db
    .select()
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.photoId, id),
        eq(schema.reports.kind, 'removal_request'),
        eq(schema.reports.status, 'open'),
      ),
    )
    .limit(1);

  if (existing) {
    return NextResponse.json({
      requested: true,
      autoHideAt: existing.autoHideAt?.toISOString() ?? null,
      alreadyOpen: true,
    });
  }

  const autoHideAt = autoHideDeadline();
  await db.insert(schema.reports).values({
    photoId: id,
    reporterActorId: actorId,
    kind: 'removal_request',
    note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
    autoHideAt,
  });

  return NextResponse.json({
    requested: true,
    autoHideAt: autoHideAt.toISOString(),
  });
}
