/**
 * The host answering a removal request — docs/design.md §13.
 *
 * Two outcomes. `remove` takes the photo down for good; `decline` clears the
 * request and un-hides the photo if the 48-hour deadline had already passed.
 * That second half is why hiding and deleting are separate states: a host who
 * was on holiday can still say no, and the photo comes back.
 */

import { recordModeration, REASON, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { dropDerivatives } from '@/removal';
import { restorePhotoLinks, revokePhotoLinks } from '@/revoke';
import { notifyRemovalAnswered } from '@/notify';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === 'remove' ? 'remove' : body.action === 'decline' ? 'decline' : null;
  if (!action) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  const db = getDb();
  const [found] = await db
    .select({ report: schema.reports, photo: schema.photos })
    .from(schema.reports)
    .innerJoin(schema.photos, eq(schema.reports.photoId, schema.photos.id))
    /*
     * Only an open removal request is the host's to answer.
     *
     * This loaded any report by id and asked only whether the caller hosted
     * the album — so a host could "decline" an abuse report, or a child-safety
     * report about their own upload, and lift the hide it had put on the
     * photograph. Those are reports to Parea, about the host's album as much
     * as anybody's, and answering them is a reviewer's job. Anything else
     * answers the same as a report that does not exist.
     */
    .where(
      and(
        eq(schema.reports.id, id),
        eq(schema.reports.kind, 'removal_request'),
        eq(schema.reports.status, 'open'),
      ),
    )
    .limit(1);

  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const event = await findEventById(db, found.photo.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  /*
   * And not on a photo held for child safety.
   *
   * Removing it would put it on the path to purge and declining would lift
   * its hide; either is a decision about evidence that belongs to whoever
   * reviews the incident, not to the album's host. The request stays open
   * and waits.
   */
  if (found.photo.status === 'quarantined') {
    return NextResponse.json({ error: 'under_review' }, { status: 409 });
  }

  const actorId = await currentActorId();
  const now = new Date();

  /*
   * Claimed before anything is done, so two presses — or two hosts — cannot
   * both act on one request.
   */
  const [claimed] = await db
    .update(schema.reports)
    .set({
      status: action === 'remove' ? 'actioned' : 'declined',
      resolvedAt: now,
      resolvedBy: actorId,
    })
    .where(and(eq(schema.reports.id, id), eq(schema.reports.status, 'open')))
    .returning({ id: schema.reports.id });
  if (!claimed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (action === 'remove') {
    await db
      .update(schema.photos)
      .set({ status: 'removed', deletedAt: now })
      .where(eq(schema.photos.id, found.photo.id));

    await dropDerivatives(db, found.photo.id);
    await revokePhotoLinks(found.photo);
  } else {
    // Declining also lifts an auto-hide that already took effect.
    await db
      .update(schema.photos)
      .set({ hiddenAt: null })
      .where(eq(schema.photos.id, found.photo.id));
    // Shown again, so the links that the auto-hide took back work again.
    await restorePhotoLinks(found.photo);
  }

  await recordModeration(db, {
    photoId: found.photo.id,
    eventId: found.photo.eventId,
    action: action === 'remove' ? 'removed' : 'unhidden',
    actorId,
    reason: action === 'remove' ? REASON.hostRemoved : REASON.hostDeclined,
  });

  // The person who asked may have no account and no reason to come back, so
  // this is the only way they learn the answer.
  await notifyRemovalAnswered(db, {
    reporterActorId: found.report.reporterActorId,
    eventId: found.photo.eventId,
    removed: action === 'remove',
  });

  return NextResponse.json({ resolved: action });
}
