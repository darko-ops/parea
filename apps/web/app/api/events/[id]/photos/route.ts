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
import { and, asc, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, guard, toResponse } from '@/access';
import { contributorKey, contributorsOf } from '@/contributors';
import { getDb } from '@/db';
import { findGroup } from '@/groups';
import { hasDerivatives, imageSources, imageSrc } from '@/images';
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
      // Which contributor chip this photo belongs to. A per-event digest, not
      // an actor id — see `contributors.ts`.
      by: photo.uploaderId ? contributorKey(event.id, photo.uploaderId) : null,
      // A 320px thumbnail rather than a multi-megabyte original: a 200-photo
      // grid of originals is ~800MB of pointless transfer.
      src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      // The same thumbnail in every encoding that exists, best first, so the
      // browser can take the AVIF if it can decode one (§11). Empty before
      // ingest, in which case `src` is the original and there is no choice.
      sources: await imageSources(photo, 'thumb', event.capEpoch),
      full: await imageSrc(photo, hasDerivatives(photo) ? 'full' : 'orig', event.capEpoch),
      // What the camera produced, untouched apart from the metadata strip.
      // The native client saves these to the camera roll: "everyone gets the
      // full collection at full quality" is the product's headline, and the
      // 2560px `full` above is a lightbox rendition, not the photo. The web
      // has no use for it — its terminal action is the zip.
      original: await imageSrc(photo, 'orig', event.capEpoch),
    })),
  );

  // The contribution count is a recruiting device, not a statistic: "6 people,
  // 88 photos" is what gets the seventh person to add theirs (design §2).
  // Kept as a number as well as a list: the native client reads this field and
  // has no use for the filter the list is for.
  const people = await contributorsOf(db, event.id, rows, viewerId);
  const contributors = people.length;

  /*
   * Uploaded and not through the deriver yet — everybody's, not this tab's.
   *
   * Counted rather than taken from `rows`, because a photo mid-ingest is not
   * in `rows`: `visiblePhotos` returns what can be looked at, and this is the
   * number for the thing that cannot be looked at yet. Deliberately not
   * filtered by uploader — "12 arriving" is about the event filling up, and
   * whose they are is not knowable until they land anyway.
   */
  const [pending] = await db
    .select({ n: countDistinct(schema.photos.id) })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.eventId, event.id),
        eq(schema.photos.status, 'pending'),
        isNull(schema.photos.deletedAt),
      ),
    );
  const arriving = pending?.n ?? 0;

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      uploadsOpen: event.uploadsOpen,
      canAdminister: (await decide(db, event, 'administer', requester)).allow,
      groupId: event.groupId,
      groupName: event.groupId ? ((await findGroup(db, event.groupId))?.name ?? null) : null,
      startsAt: event.startsAt?.toISOString() ?? null,
    },
    contributors,
    people,
    arriving,
    count: photos.length,
    photos,
  });
}
