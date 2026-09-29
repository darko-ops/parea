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
import { and, count, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { guard, isSignedIn, toResponse } from '@/access';
import { getDb } from '@/db';
import { findPhotoWithEvent } from '@/moderation';
import {
  REMOVAL_REQUEST_LIMIT,
  REMOVAL_REQUESTS_OPEN_PER_EVENT,
  withinLimit,
  withinLimitFor,
} from '@/ratelimit';
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

  /*
   * An account, and a limit.
   *
   * An unanswered request hides its photo after 48 hours, and anybody who
   * could see an album — signed out, through a forwarded link — could file one
   * against every photo in it, with nothing to stop them. Two days later the
   * album was gone unless the host declined each by hand. Asking for a photo
   * of you to come down is something a person does, and they are signed in to
   * do it; a limit per hour and a cap per album bound what one account can do.
   */
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }
  const secret = process.env.SESSION_SECRET;
  if (
    !(await withinLimit(db, REMOVAL_REQUEST_LIMIT, secret)) ||
    !(await withinLimitFor(db, REMOVAL_REQUEST_LIMIT, secret, actorId))
  ) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const [{ open } = { open: 0 }] = await db
    .select({ open: count() })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.reporterActorId, actorId),
        eq(schema.reports.kind, 'removal_request'),
        eq(schema.reports.status, 'open'),
        inArray(
          schema.reports.photoId,
          db
            .select({ id: schema.photos.id })
            .from(schema.photos)
            .where(eq(schema.photos.eventId, found.event.id)),
        ),
      ),
    );
  if (open >= REMOVAL_REQUESTS_OPEN_PER_EVENT) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

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
