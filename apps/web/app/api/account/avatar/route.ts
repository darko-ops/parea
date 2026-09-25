/**
 * A profile picture.
 *
 * The second path in this product by which a person's image becomes bytes we
 * store, and the first one — an event photo — goes through metadata stripping,
 * a content hash, a child-safety scanner and a quarantine route before anyone
 * can see it. None of the reasons for that stop applying because the picture
 * is small and of the uploader.
 *
 * So this re-encodes rather than storing what arrived. sharp decodes to pixels
 * and writes a fresh JPEG, and nothing that was not pixels survives that: no
 * EXIF, no GPS, no camera serial, no thumbnail-of-the-original hiding inside
 * the file. A selfie taken at home carries the same coordinates as any other
 * photograph, and §7.6 refuses to serve those for event photos.
 *
 * Re-encoding also *is* the derivative. An avatar has one size and no lightbox,
 * so there is nothing for the deriver to do afterwards and no reason to send it
 * round that loop — which is the honest reason it does not go through the
 * scanner: the scanner is reached from the deriver's pipeline, which is
 * event-shaped. What that leaves open is written down in the runbook rather
 * than left implied.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { admit, decode } from '@/imaging';
import { AVATAR_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

/**
 * The largest place it is drawn, at 3x.
 *
 * 256 was sized for a 64px avatar, and the profile header has since grown to
 * a 172pt square — 516 physical pixels on a phone, which a 256px JPEG reaches
 * by being upscaled to twice its size. 512 is that, near enough, and an
 * avatar is one small file per person.
 */
const EDGE = 512;
/** A generous phone photograph. Past this it is not a profile picture. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  /*
   * Bounded before a byte is decoded, and bounded per source rather than per
   * actor.
   *
   * An actor is minted on demand — `POST /api/session` hands one to anybody —
   * so a per-actor cap on this route is a cap on honesty, exactly as the
   * uploads route says about its own. What is being protected is not storage
   * but CPU and memory in the web tier: this is the cheapest way to make a
   * request handler decode an image, and the only one here that does not
   * require being let into an event first.
   */
  if (!(await withinLimit(getDb(), AVATAR_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  // Size and file type, before a decoder sees it. See `@/imaging`.
  const admitted = admit(Buffer.from(await request.arrayBuffer()), MAX_BYTES);
  if (!admitted.ok) {
    return NextResponse.json({ error: admitted.error }, { status: admitted.status });
  }

  let jpeg: Buffer;
  try {
    jpeg = await decode(admitted.bytes)
      // Bakes in orientation, so a picture taken sideways is not stored
      // sideways for everyone who lacks the tag to correct it.
      .rotate()
      /*
       * Square, and centred rather than clever.
       *
       * `attention` picks the crop itself from where the detail is, which is
       * the right default for a cover somebody never framed. This picture was
       * framed: the picker hands back a square the uploader chose, so there
       * is nothing here for `cover` to trim — and on the day something
       * non-square arrives, honouring the middle of what they sent beats
       * a second opinion about where their face is.
       */
      .resize({ width: EDGE, height: EDGE, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    // Anything sharp cannot decode, which includes a file that is not an image
    // and an image that is a decompression bomb.
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }

  // Keyed by actor rather than by content: there is one per person, the old
  // one is meant to be replaced, and a content-addressed key would leave every
  // picture anyone ever set in the bucket forever.
  const key = `avatars/${actorId}.jpg`;
  await getStorage().putSmall(key, jpeg, 'image/jpeg');

  await getDb()
    .update(schema.actors)
    .set({ avatarKey: key })
    .where(eq(schema.actors.id, actorId));

  return NextResponse.json({ ok: true });
}

/** Remove it. The object goes too — an unreferenced one is never read again. */
export async function DELETE() {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const [row] = await db
    .select({ avatarKey: schema.actors.avatarKey })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);

  if (row?.avatarKey) {
    await getStorage().delete(row.avatarKey).catch(() => {});
  }
  await db
    .update(schema.actors)
    .set({ avatarKey: null })
    .where(eq(schema.actors.id, actorId));

  return NextResponse.json({ ok: true });
}
