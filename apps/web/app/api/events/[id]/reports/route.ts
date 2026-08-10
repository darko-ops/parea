/**
 * The host's queue of removal requests — docs/design.md §13.
 *
 * Someone asked for a photo of themselves to come down. Without a screen that
 * shows these, the 48-hour auto-hide becomes the only outcome that ever
 * happens, and the host's ability to decline is theoretical.
 *
 * Only removal requests. Abuse reports go to us, not the host, so they are
 * deliberately absent from this list.
 */

import { schema } from '@parea/core';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { hasDerivatives, imageSrc } from '@/images';
import { requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const rows = await db
    .select({ report: schema.reports, photo: schema.photos })
    .from(schema.reports)
    .innerJoin(schema.photos, eq(schema.reports.photoId, schema.photos.id))
    .where(
      and(
        eq(schema.photos.eventId, event.id),
        eq(schema.reports.kind, 'removal_request'),
        eq(schema.reports.status, 'open'),
      ),
    )
    .orderBy(asc(schema.reports.autoHideAt));

  const reports = await Promise.all(
    rows.map(async ({ report, photo }) => ({
      id: report.id,
      note: report.note,
      autoHideAt: report.autoHideAt?.toISOString() ?? null,
      // Already hidden by the deadline passing — the host can still decline
      // and bring it back, which is the whole reason hiding is reversible.
      alreadyHidden: photo.hiddenAt !== null,
      photo: {
        id: photo.id,
        src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      },
    })),
  );

  return NextResponse.json({ reports });
}
