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
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { admit, decode } from '@/imaging';
import { momentsResponse } from '@/moments';
import { MOMENT_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

/** The long edge, stored. The full rendition of a roll photograph is 2560. */
const EDGE = 2048;
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const actorId = await currentActorId();
  return NextResponse.json(await momentsResponse(actorId));
}

export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  if (!(await withinLimit(getDb(), MOMENT_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const admitted = admit(Buffer.from(await request.arrayBuffer()), MAX_BYTES);
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
  try {
    out = await decode(admitted.bytes)
      .rotate()
      // Never cropped: this is somebody's whole photograph, drawn whole.
      .resize({ width: EDGE, height: EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
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
  try {
    await getStorage().putSmall(key, out.data, 'image/jpeg');
  } catch {
    await db.delete(schema.moments).where(eq(schema.moments.id, row!.id));
    return NextResponse.json({ error: 'storage_failed' }, { status: 502 });
  }
  await db.update(schema.moments).set({ key }).where(eq(schema.moments.id, row!.id));

  return NextResponse.json({ id: row!.id });
}
