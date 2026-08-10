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

import { schema } from '@parea/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

const IMAGE_URL_TTL_SECONDS = 3600;

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
    .where(
      and(
        eq(schema.photos.eventId, event.id),
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${schema.photos.capturedAt}, ${schema.photos.uploadedAt})`),
    );

  const storage = getStorage();
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
      src: await storage.presignGet(photo.storageKey, IMAGE_URL_TTL_SECONDS),
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
    },
    contributors,
    count: photos.length,
    photos,
  });
}
