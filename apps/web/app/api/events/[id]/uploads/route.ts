/**
 * Presign a batch of uploads — step 2 of design §7.5.
 *
 * Returns one PUT URL per file. The client then talks to storage directly;
 * bytes never come back through here.
 */

import { schema } from '@parea/core';
import { acceptedMime, MAX_FILES_PER_PRESIGN, MAX_UPLOAD_BYTES, MAX_UPLOAD_NAME } from '@parea/upload';
import { and, count, eq, isNull, sum } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, recordParticipant, toResponse } from '@/access';
import { getDb } from '@/db';
import { isBlockedBy } from '@/moderation';
import { PRESIGN_LIMIT, PRESIGN_NETWORK_LIMIT, withinLimit, withinLimitFor } from '@/ratelimit';
import { currentAccountActorId, ensureActor, requesterFor } from '@/session';
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
// The client has to know this to skip a file rather than send one the route
// will refuse, so it is shared — see `MAX_UPLOAD_BYTES`.
const MAX_BYTES_PER_FILE = MAX_UPLOAD_BYTES;
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

  const parsed = parseFiles(body.files);
  if (!Array.isArray(parsed)) {
    // `invalid_files` stays the error, because that is what clients switch on.
    // Everything beside it is new and is there to be read.
    return NextResponse.json({ error: 'invalid_files', ...parsed }, { status: 400 });
  }
  const files = parsed;

  const db = getDb();

  // Before the event lookup and before an actor exists, because the cheapest
  // thing to refuse is a request nothing has been spent on yet — and because
  // this is the one bound that survives the caller discarding their cookie
  // between requests.
  //
  // Who is counted depends on who is asking. Somebody signed in is counted as
  // themselves: a party on one venue's wifi shares an address, and counting
  // the address refused uploads once a few dozen guests had posted. The
  // network keeps a ceiling ten times higher, so a crowd of fresh accounts
  // behind one address is still bounded. Somebody without an account can mint
  // a new identity by clearing a cookie, so for them the address is the only
  // thing worth counting, as before.
  const secret = process.env.SESSION_SECRET;
  const account = await currentAccountActorId();
  const allowed = account
    ? (await withinLimitFor(db, PRESIGN_LIMIT, secret, `account:${account}`)) &&
      (await withinLimit(db, PRESIGN_NETWORK_LIMIT, secret))
    : await withinLimit(db, PRESIGN_LIMIT, secret);
  if (!allowed) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  });

  try {
    await guard(db, event, 'upload', requester);
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

  /*
   * One insert for the whole batch, in the order the files were picked.
   *
   * A roll is drawn as a stack — each addition on top, and the first pick of
   * one lowest in it — and `addedSeq` is what says that. Its values are taken
   * row by row down this list, so writing the rows together keeps the order
   * the list arrived in; writing them one at a time in parallel, as this used
   * to, numbered them in whatever order the inserts happened to finish.
   *
   * A random discriminator in the key, not a content hash: the client cannot
   * be asked to hash 200 files on a phone, and the deriver rewrites the key to
   * a content-addressed one once it has actually read the bytes.
   */
  const keys = files.map(() => objectKey(event.id, `${crypto.randomUUID()}`));
  const rows = await db
    .insert(schema.photos)
    .values(
      files.map((file, i) => ({
        eventId: event.id,
        uploaderId: actorId,
        storageKey: keys[i]!,
        byteSize: file.size,
        mime: file.type,
        status: 'pending' as const,
      })),
    )
    .returning({ id: schema.photos.id, storageKey: schema.photos.storageKey });
  // Matched on the key rather than trusted to come back in the order sent.
  const idFor = new Map(rows.map((row) => [row.storageKey, row.id]));

  const uploads = await Promise.all(
    files.map(async (file, i) => {
      const key = keys[i]!;
      // The declared size goes into the signature, so the body has to match
      // the number this row's quota was charged against. See `presignPut`.
      const presigned = await storage.presignPut(key, file.type, file.size);
      return {
        photoId: idFor.get(key)!,
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

/**
 * The refused request, said in enough detail to act on.
 *
 * It was the bare string `invalid_files` for six different conditions, and the
 * note above already regretted that the uploader "had no way to know why".
 * That cost a real morning: four photographs, a 400, and nothing anywhere
 * saying which of the four or what was wrong with it.
 *
 * Both clients filter before sending — see `refuseFile` — so reaching this is
 * either a client that has drifted or one nobody here wrote. Either way the
 * answer belongs in the response rather than in somebody's afternoon.
 *
 * The name is echoed and nothing else is: it came from the caller, it is the
 * one thing that identifies which file, and it is already theirs.
 */
type Refused = { reason: string; at: number; name?: string };

function parseFiles(value: unknown): FileRequest[] | Refused {
  if (!Array.isArray(value)) return { reason: 'not_a_list', at: -1 };
  if (value.length === 0) return { reason: 'no_files', at: -1 };
  /*
   * The same constant the queue chunks by, imported rather than restated.
   *
   * It was a fifty here and nothing at all on the client, which sent every
   * photograph waiting for an album in one call. Fifty-one was refused whole
   * — note that this returns null rather than a short list, so no row is
   * written and nothing partially succeeds — and the uploader had no way to
   * know why. See `MAX_FILES_PER_PRESIGN`.
   */
  if (value.length > MAX_FILES_PER_PRESIGN) {
    return { reason: 'too_many_files', at: -1 };
  }

  const out: FileRequest[] = [];
  for (const [at, raw] of value.entries()) {
    if (typeof raw !== 'object' || raw === null) return { reason: 'not_a_file', at };
    const { name, size, type } = raw as Record<string, unknown>;
    const named = typeof name === 'string' ? name : undefined;
    if (typeof name !== 'string') return { reason: 'no_name', at };
    if (name.length > MAX_UPLOAD_NAME) return { reason: 'name_too_long', at, name: named };
    /*
     * Zero is the one that actually happened.
     *
     * A browser hands back a well-typed `File` of no bytes for a folder
     * dropped instead of its contents, for a cloud file the OS never
     * materialised, and for a photograph moved between the dialog and the
     * upload. The presign signs a `content-length`, so a file of no length has
     * nothing to sign and nothing to send.
     */
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      return { reason: 'empty_file', at, name: named };
    }
    if (size > MAX_BYTES_PER_FILE) return { reason: 'file_too_big', at, name: named };
    // The authoritative check. A picker that hides videos is a courtesy; this
    // is what makes it true, because anything can POST here — and what gets
    // past it is stored, quota'd, and then fails in the deriver where nobody
    // is watching.
    if (typeof type !== 'string') return { reason: 'no_type', at, name: named };
    const mime = acceptedMime(type);
    if (!mime) return { reason: 'unacceptable_type', at, name: named };
    out.push({ name, size, type: mime });
  }
  return out;
}
