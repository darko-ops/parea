/**
 * The picture an album leads with.
 *
 * Raw bytes in, one wide JPEG out, and the key on the event. The shape is
 * `/api/account/avatar` rather than the photo pipeline, and the reasons are the
 * same three: it is one small image, it has one size and no lightbox, and it
 * has to exist *now* — a cover chosen while making an album cannot wait for a
 * queue of two hundred photographs to reach it.
 *
 * So it re-encodes rather than storing what arrived. sharp decodes to pixels
 * and writes a fresh JPEG, and nothing that was not pixels survives that: no
 * EXIF, no GPS, no camera serial, no thumbnail of the original hiding inside
 * the file. That matters more here than for an avatar — §7.6 refuses to serve
 * coordinates for event photographs, and a cover is an event photograph that
 * came in through a different door.
 *
 * What the different door does not have is the child-safety scanner, which is
 * reached from the deriver's pipeline. In practice the same bytes almost
 * always go up as an ordinary photograph too, and that copy is scanned; what
 * is left uncovered is a cover whose photograph was later quarantined.
 * docs/csam-runbook.md carries the step that closes it, and this route keeps
 * the object under the album's own prefix so that step is one delete.
 *
 * Administer, not contribute. The cover is the album's face on somebody else's
 * home screen, and everyone who can add a photograph should not be able to
 * change it.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import sharp from 'sharp';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

/**
 * Wide, because that is the shape it is drawn in.
 *
 * A card is a landscape rectangle about 600 points across, so 1200 covers a
 * retina screen and nothing beyond it is ever seen. `attention` crops towards
 * whatever sharp thinks the subject is, which is the difference between a
 * group photograph and four foreheads.
 */
const WIDTH = 1200;
const HEIGHT = 800;
/** A generous phone photograph. Past this it is not a cover. */
const MAX_BYTES = 25 * 1024 * 1024;

/** One per album, replaced rather than accumulated. Under its own prefix. */
const keyFor = (eventId: string) => `ev/${eventId}/cover.jpg`;

async function mayAdminister(id: string) {
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  try {
    await guard(db, event, 'administer', await requesterFor(id, {}));
  } catch (err) {
    return { error: toResponse(err) };
  }
  return { db, event };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const allowed = await mayAdminister(id);
  if ('error' in allowed) return allowed.error;
  const { db, event } = allowed;

  const incoming = Buffer.from(await request.arrayBuffer());
  if (incoming.byteLength === 0) {
    return NextResponse.json({ error: 'empty' }, { status: 400 });
  }
  if (incoming.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(incoming, { failOn: 'error' })
      // Bakes in orientation, so a picture taken sideways is not stored
      // sideways for everyone whose renderer lacks the tag to correct it.
      .rotate()
      .resize({ width: WIDTH, height: HEIGHT, fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    /*
     * Anything sharp cannot decode: a file that is not an image, a
     * decompression bomb — and HEIC, on a build of libvips without libheif.
     * The caller treats this as "no cover" rather than as a failed album,
     * which is why it is worth answering precisely rather than 500ing.
     */
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }

  // `objectKey` builds the same string, and this deliberately does not use it:
  // that helper's discriminator is a photograph's, and a cover is not one.
  const key = keyFor(event.id);
  await getStorage().putSmall(key, jpeg, 'image/jpeg');
  await db
    .update(schema.events)
    .set({ coverKey: key })
    .where(eq(schema.events.id, event.id));

  return NextResponse.json({ ok: true });
}

/**
 * Take it off. The object goes too — an unreferenced one is never read again,
 * and this is the delete the runbook asks for.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const allowed = await mayAdminister(id);
  if ('error' in allowed) return allowed.error;
  const { db, event } = allowed;

  await db
    .update(schema.events)
    .set({ coverKey: null })
    .where(eq(schema.events.id, event.id));
  if (event.coverKey) await getStorage().delete(event.coverKey).catch(() => {});

  return NextResponse.json({ ok: true });
}
