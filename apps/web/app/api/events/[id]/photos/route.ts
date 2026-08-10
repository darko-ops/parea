/**
 * List an event's photos — screen 3 of design §3.
 *
 * Returns metadata plus a presigned URL per photo. The browser fetches image
 * bytes from storage directly; this handler never touches them.
 *
 * Sorted by `coalesce(captured_at, uploaded_at)`. Both halves of that are known
 * to be imperfect — six phones disagree about the time, and iOS Safari strips
 * EXIF on upload so web-contributed photos may have no capture time at all
 * (design §8). v1 accepts it.
 */

import { schema, visiblePhotos } from '@parea/core';
import { asc, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { findGroup } from '@/groups';
import { hasDerivatives, imageSrc } from '@/images';
import { viewerContext } from '@/moderation';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: url.searchParams.get('t') ?? undefined,
    code: url.searchParams.get('c') ?? undefined,
  });

  try {
    await guard(db, event, 'view', requester);
  } catch (err) {
    return toResponse(err);
  }

  const rows = await db
    .select()
    .from(schema.photos)
    // One shared predicate for deleted / removed / hidden / blocked — see
    // @parea/core's visibility module for why those are four states.
    .where(visiblePhotos(event.id, await viewerContext(db, await currentActorId())))
    .orderBy(
      asc(sql`coalesce(${schema.photos.capturedAt}, ${schema.photos.uploadedAt})`),
    );

  const viewerId = await currentActorId();

  const photos = await Promise.all(
    rows.map(async (photo) => ({
      id: photo.id,
      width: photo.width,
      height: photo.height,
      mime: photo.mime,
      byteSize: photo.byteSize,
      takenAt: (photo.capturedAt ?? photo.uploadedAt).toISOString(),
      // Surfaced so the client can offer "remove" only where it will work.
      mine: viewerId != null && photo.uploaderId === viewerId,
      // A 320px thumbnail rather than a multi-megabyte original: a 200-photo
      // grid of originals is ~800MB of pointless transfer.
      src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      full: await imageSrc(photo, hasDerivatives(photo) ? 'full' : 'orig', event.capEpoch),
    })),
  );

  // The contribution count is a recruiting device, not a statistic: "6 people,
  // 88 photos" is what gets the seventh person to add theirs (design §2).
  const contributors = new Set(rows.map((p) => p.uploaderId)).size;

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      uploadsOpen: event.uploadsOpen,
      canAdminister: (await decide(db, event, 'administer', requester)).allow,
      groupId: event.groupId,
      groupName: event.groupId ? ((await findGroup(db, event.groupId))?.name ?? null) : null,
    },
    contributors,
    count: photos.length,
    photos,
  });
}
