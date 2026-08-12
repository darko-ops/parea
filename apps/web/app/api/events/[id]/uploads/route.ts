/**
 * Presign a batch of uploads — step 2 of design §7.5.
 *
 * Returns one PUT URL per file. The client then talks to storage directly;
 * bytes never come back through here.
 */

import { schema } from '@parea/core';
import { acceptedMime } from '@parea/upload';
import { and, count, eq, isNull, sum } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, recordParticipant, toResponse } from '@/access';
import { getDb } from '@/db';
import { isBlockedBy } from '@/moderation';
import { PRESIGN_LIMIT, withinLimit } from '@/ratelimit';
import { ensureActor, requesterFor } from '@/session';
import { getStorage, objectKey } from '@/storage';

export const runtime = 'nodejs';

/**
 * Anti-catastrophe bounds, not product limits — design §7.8.
 *
 * Anyone with a link can upload anything, and a link travels. These exist so
 * that one person, or one forwarded link in the wrong hands, cannot fill the
 * bucket. They are set far above what a real contributor does: 500 photos is
 * more than anyone brings back from a party, and if someone hits one it is
 * worth knowing rather than silently allowing.
 */
const MAX_FILES_PER_REQUEST = 50;
const MAX_BYTES_PER_FILE = 200 * 1024 * 1024;
const MAX_PHOTOS_PER_ACTOR_PER_EVENT = 500;
const MAX_BYTES_PER_ACTOR_PER_EVENT = 5 * 1024 * 1024 * 1024;

/**
 * The bound that does not depend on who is asking.
 *
 * The per-actor cap above is the right shape for an honest heavy shooter and
 * no shape at all for anyone hostile: an actor is minted on demand and costs
 * nothing, so clearing a cookie buys a fresh 500 photos, and the cap written
 * to stop "one forwarded link in the wrong hands" stopped nothing.
 *
 * A link grants access to exactly one event, so the event is the unit whose
 * total has to be bounded — and an aggregate over rows is not something a
 * client can reset. 20,000 photos is roughly eighty times a typical event and
 * eight times a large wedding; 100GB is the same again in bytes, and binds
 * first for anyone uploading video.
 */
const MAX_PHOTOS_PER_EVENT = 20_000;
const MAX_BYTES_PER_EVENT = 100 * 1024 * 1024 * 1024;

type FileRequest = { name: string; size: number; type: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    files?: unknown;
    linkToken?: unknown;
    code?: unknown;
    displayName?: unknown;
  };

  const files = parseFiles(body.files);
  if (!files) return NextResponse.json({ error: 'invalid_files' }, { status: 400 });

  const db = getDb();

  // Before the event lookup and before an actor exists, because the cheapest
  // thing to refuse is a request nothing has been spent on yet — and because
  // this is the one bound that survives the caller discarding their cookie
  // between requests.
  if (!(await withinLimit(db, PRESIGN_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  });

  try {
    await guard(db, event, 'contribute', requester);
  } catch (err) {
    return toResponse(err);
  }

  // Only now does a browsing visitor become an actor.
  const actorId = await ensureActor(
    db,
    typeof body.displayName === 'string' ? body.displayName.trim() : undefined,
  );

  // The second half of what a block means: blocked by the host, cannot
  // contribute here. Checked after the actor exists, because until someone
  // contributes there is nobody to have blocked.
  if (await isBlockedBy(db, event.createdBy, actorId)) {
    return NextResponse.json({ error: 'blocked' }, { status: 403 });
  }

  await recordParticipant(db, event.id, actorId);

  // Per-request limits alone bound nothing: a thousand requests of fifty files
  // is still a thousand requests. The cap that matters is cumulative.
  const incomingBytes = files.reduce((total, file) => total + file.size, 0);
  const [mine, total] = await Promise.all([
    used(db, event.id, actorId),
    used(db, event.id),
  ]);

  if (
    mine.photos + files.length > MAX_PHOTOS_PER_ACTOR_PER_EVENT ||
    mine.bytes + incomingBytes > MAX_BYTES_PER_ACTOR_PER_EVENT
  ) {
    // Worth knowing about: the bound is set far above real use, so hitting it
    // means either abuse or an assumption about real use being wrong.
    console.warn(
      `quota: actor ${actorId} at ${mine.photos} photos / ${mine.bytes} bytes ` +
        `on event ${event.id}, requested ${files.length} more`,
    );
    return NextResponse.json(
      {
        error: 'quota_exceeded',
        photos: mine.photos,
        maxPhotos: MAX_PHOTOS_PER_ACTOR_PER_EVENT,
      },
      { status: 429 },
    );
  }

  if (
    total.photos + files.length > MAX_PHOTOS_PER_EVENT ||
    total.bytes + incomingBytes > MAX_BYTES_PER_EVENT
  ) {
    console.warn(
      `event quota: ${event.id} at ${total.photos} photos / ${total.bytes} bytes, ` +
        `requested ${files.length} more`,
    );
    return NextResponse.json(
      { error: 'event_full', photos: total.photos, maxPhotos: MAX_PHOTOS_PER_EVENT },
      { status: 429 },
    );
  }

  const storage = getStorage();
  const uploads = await Promise.all(
    files.map(async (file) => {
      // A random discriminator, not a content hash: the client cannot be asked
      // to hash 200 files on a phone, and the deriver rewrites the key to a
      // content-addressed one once it has actually read the bytes.
      const key = objectKey(event.id, `${crypto.randomUUID()}`);
      const [photo] = await db
        .insert(schema.photos)
        .values({
          eventId: event.id,
          uploaderId: actorId,
          storageKey: key,
          byteSize: file.size,
          mime: file.type,
          status: 'pending',
        })
        .returning();

      const presigned = await storage.presignPut(key, file.type);
      return {
        photoId: photo!.id,
        name: file.name,
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
        expiresAt: presigned.expiresAt.toISOString(),
      };
    }),
  );

  return NextResponse.json({ uploads }, { status: 201 });
}

/**
 * What is already in this event — all of it, or one actor's share.
 *
 * Counts pending rows as well as ready ones: a presign that was never followed
 * by an upload still reserved a row, and ignoring those would let someone
 * bypass the cap by never completing. Tombstoned photos do not count, because
 * removing your own upload should give the space back.
 *
 * One function for both bounds so they cannot come to disagree about what
 * counts. The accounting rules above are the subtle part, and they are the
 * same rules whichever total is being taken.
 */
async function used(
  db: ReturnType<typeof getDb>,
  eventId: string,
  actorId?: string,
): Promise<{ photos: number; bytes: number }> {
  const [row] = await db
    .select({ photos: count(), bytes: sum(schema.photos.byteSize) })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.eventId, eventId),
        actorId ? eq(schema.photos.uploaderId, actorId) : undefined,
        isNull(schema.photos.deletedAt),
      ),
    );
  return { photos: row?.photos ?? 0, bytes: Number(row?.bytes ?? 0) };
}

function parseFiles(value: unknown): FileRequest[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_FILES_PER_REQUEST) return null;

  const out: FileRequest[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { name, size, type } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || name.length > 512) return null;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
    if (size > MAX_BYTES_PER_FILE) return null;
    // The authoritative check. A picker that hides videos is a courtesy; this
    // is what makes it true, because anything can POST here — and what gets
    // past it is stored, quota'd, and then fails in the deriver where nobody
    // is watching.
    if (typeof type !== 'string') return null;
    const mime = acceptedMime(type);
    if (!mime) return null;
    out.push({ name, size, type: mime });
  }
  return out;
}
