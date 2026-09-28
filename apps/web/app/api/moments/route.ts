/**
 * Moments: the row on Home, and putting one up.
 *
 * `POST` takes the picture's bytes and nothing else, like the avatar route and
 * for the same reasons, which that route sets out at length: it re-encodes
 * rather than storing what arrived, so no EXIF, no GPS and no embedded
 * original survive, and the re-encode *is* the one rendition — there is no
 * lightbox size to derive and so no trip through the deriver.
 *
 * What that also means is the gap the avatar route admits: this does not pass
 * the child-safety scanner, which is reached from the deriver's event-shaped
 * pipeline. A moment is seen by more people than an avatar is, and closing
 * that is on the launch checklist rather than implied to be handled here.
 */

import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { admit, decode } from '@/imaging';
import { MOMENT_MAX_BYTES, incomingPrefix, momentsResponse } from '@/moments';
import { MOMENT_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

/** The long edge, stored. The full rendition of a roll photograph is 2560. */
const EDGE = 2048;

/** The strip's copy: a tile is about 70 points, so 360 covers a 3x screen. */
const THUMB_EDGE = 360;

/**
 * The stream on Home, or — with `?by=<handle>` — one person's moments, which
 * is what their page draws. Either way only what this viewer may see.
 */
export async function GET(request: Request) {
  const actorId = await currentActorId();
  const handle = new URL(request.url).searchParams.get('by');
  if (handle === null) return NextResponse.json(await momentsResponse(actorId));

  const [person] = await getDb()
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(eq(sql`lower(${schema.actors.handle})`, handle.replace(/^@/, '').toLowerCase()))
    .limit(1);
  if (!person) return NextResponse.json({ moments: [] });
  return NextResponse.json(await momentsResponse(actorId, { by: person.id }));
}

/**
 * Two ways in, one moment out.
 *
 * `{ key }` as JSON is the usual one: the picture was PUT straight to storage
 * against a URL from `/api/moments/uploads`, and this reads it back once to
 * re-encode it. That exists because a request body here is capped by the
 * platform at about 4.5MB, and a photograph off a current phone is larger —
 * every Share from an iPhone was answered 413 before a line of this ran.
 *
 * Raw bytes as the body is the original way, kept for a client that has not
 * updated: it still works for anything under the platform's cap.
 *
 * Reading the upload back is not the egress the storage interface is built to
 * prevent. That rule is about serving photographs *out* through this origin,
 * where one album can be gigabytes times every guest; this is one inbound
 * picture, read once, the same bytes the raw-body path already carried.
 */
export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const json = (request.headers.get('content-type') ?? '').includes('application/json');

  let incoming: Buffer;
  let staged: string | null = null;
  if (json) {
    const body = (await request.json().catch(() => ({}))) as { key?: unknown };
    if (typeof body.key !== 'string' || !body.key.startsWith(incomingPrefix(actorId))) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    staged = body.key;
    const read = await readStaged(staged);
    if (!read.ok) {
      console.warn('moment refused', { error: read.error });
      return NextResponse.json({ error: read.error }, { status: read.status });
    }
    incoming = read.bytes;
  } else {
    // The upload route is where the limit is spent on the staged path.
    if (!(await withinLimit(getDb(), MOMENT_LIMIT, process.env.SESSION_SECRET))) {
      return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
    }
    incoming = Buffer.from(await request.arrayBuffer());
  }

  const made = await makeMoment(actorId, incoming);
  // The staged original goes whether or not it became a moment: it is either
  // copied, or refused, and in neither case read again.
  if (staged) await getStorage().delete(staged).catch(() => {});
  return made;
}

async function readStaged(
  key: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string; status: number }> {
  const storage = getStorage();
  const head = await storage.head(key).catch(() => null);
  if (!head) return { ok: false, error: 'not_uploaded', status: 404 };
  if (head.size > MOMENT_MAX_BYTES) return { ok: false, error: 'too_large', status: 413 };
  const res = await fetch(await storage.presignGet(key, 60)).catch(() => null);
  if (!res?.ok) return { ok: false, error: 'storage_failed', status: 502 };
  return { ok: true, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function makeMoment(actorId: string, incoming: Buffer): Promise<NextResponse> {
  const admitted = admit(incoming, MOMENT_MAX_BYTES);
  if (!admitted.ok) {
    console.warn('moment refused', { error: admitted.error });
    return NextResponse.json({ error: admitted.error }, { status: admitted.status });
  }
  /*
   * HEIC and AVIF pass the sniff — they are accepted *event* photos, which the
   * deriver decodes — but this tier's libvips has no HEVC or AV1 decoder, so
   * sharp would refuse them below as "not an image". Said as what it is
   * instead: a well-formed photo in a format this route cannot read, which a
   * client can turn into a sentence.
   */
  if (admitted.mime === 'image/heic' || admitted.mime === 'image/avif') {
    console.warn('moment refused', { error: 'unsupported_type', mime: admitted.mime });
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  let out: { data: Buffer; info: { width: number; height: number } };
  let thumb: Buffer;
  try {
    out = await decode(admitted.bytes)
      .rotate()
      // Never cropped: this is somebody's whole photograph, drawn whole.
      .resize({ width: EDGE, height: EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    // Square, because the strip is squares — cut from the re-encoded copy,
    // so nothing but pixels reaches this one either.
    thumb = await decode(out.data)
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'cover', position: 'attention' })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.warn('moment refused', {
      error: 'not_an_image',
      mime: admitted.mime,
      bytes: admitted.bytes.byteLength,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .insert(schema.moments)
    .values({
      actorId,
      // Filled in below, once the id exists to name the object by.
      key: '',
      width: out.info.width,
      height: out.info.height,
    })
    .returning({ id: schema.moments.id });

  const key = `moments/${actorId}/${row!.id}.jpg`;
  const thumbKey = `moments/${actorId}/${row!.id}-t.jpg`;
  try {
    await Promise.all([
      getStorage().putSmall(key, out.data, 'image/jpeg'),
      getStorage().putSmall(thumbKey, thumb, 'image/jpeg'),
    ]);
  } catch {
    await db.delete(schema.moments).where(eq(schema.moments.id, row!.id));
    return NextResponse.json({ error: 'storage_failed' }, { status: 502 });
  }
  await db
    .update(schema.moments)
    .set({ key, thumbKey })
    .where(eq(schema.moments.id, row!.id));

  return NextResponse.json({ id: row!.id });
}
