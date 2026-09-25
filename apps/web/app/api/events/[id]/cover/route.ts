/**
 * The picture an event leads with.
 *
 * Raw bytes in, one wide JPEG out, and the key on the event. The shape is
 * `/api/account/avatar` rather than the photo pipeline, and the reasons are the
 * same three: it is one small image, it has one size and no lightbox, and it
 * has to exist *now* — a cover chosen while making an event cannot wait for a
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
 * the object under the event's own prefix so that step is one delete.
 *
 * Administer, not contribute. The cover is the event's face on somebody else's
 * home screen, and everyone who can add a photograph should not be able to
 * change it.
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { coverAspect, coverSize, framingOf, orientedSize, regionFor } from '@/cover';
import { getDb } from '@/db';
import { admit, decode } from '@/imaging';
import { requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

/** A generous phone photograph. Past this it is not a cover. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Shape-checked before it reaches the database, which is where a `uuid`
    column would otherwise raise on a string that is not one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One per event, replaced rather than accumulated. Under its own prefix. */
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

  // Size and file type, before a decoder sees it. See `@/imaging`. No rate
  // limit here and one on the avatar route, because `administer` already
  // bounds this to people who made the event or admin its group — a caller
  // who has to be let in first is not the unbounded case.
  const admitted = admit(Buffer.from(await request.arrayBuffer()), MAX_BYTES);
  if (!admitted.ok) {
    return NextResponse.json({ error: admitted.error }, { status: admitted.status });
  }
  const incoming = admitted.bytes;

  const url = new URL(request.url);
  const framing = framingOf(url);

  /*
   * Which photograph this was cut from, when the caller knows.
   *
   * Recorded so that "change the cover" can reopen the frame on the picture it
   * is currently made of, at the position it was left at. Nothing about the
   * finished JPEG says either — it is the *result* of a crop — so if this is
   * not stored the only thing a client can offer is starting again.
   *
   * Verified against this event rather than trusted. The id decides nothing
   * about the bytes, which arrived in the body and are re-encoded either way,
   * so a wrong one cannot produce a cover of somebody else's photograph. What
   * it would do is leave a row claiming this album's cover came from an album
   * the reader cannot see, and hand back a presigned thumbnail of it next time
   * somebody opened the frame — so it is checked, and an id that does not
   * belong here is simply not written down.
   */
  const claimed = url.searchParams.get('photo');
  const from =
    claimed && UUID.test(claimed)
      ? (
          await db
            .select({ id: schema.photos.id })
            .from(schema.photos)
            .where(and(eq(schema.photos.id, claimed), eq(schema.photos.eventId, event.id)))
            .limit(1)
        )[0]?.id ?? null
      : null;

  /*
   * The picture's own shape decides the cover's, so this is read for every
   * upload rather than only for a framed one.
   *
   * A cover used to be 3:2 whatever arrived, which is a landscape crop of a
   * portrait photograph on a screen whose whole width was going spare. What
   * `coverSize` gives back is bounded — see `COVER_TALLEST` — so this is still
   * one small wide-ish JPEG and never a client-chosen number of pixels.
   */
  const size = orientedSize(await decode(incoming).metadata().catch(() => ({})));
  const target = size ? coverSize(size) : null;

  let jpeg: Buffer;
  try {
    if (!target || !size) throw new Error('no dimensions');

    // Bakes in orientation, so a picture taken sideways is not stored sideways
    // for everyone whose renderer lacks the tag to correct it.
    let pipeline = decode(incoming).rotate();

    const region = framing ? regionFor(size, framing) : null;
    if (region) pipeline = pipeline.extract(region);

    jpeg = await pipeline
      /*
       * Still `cover`, and after an extract it is a straight scale: the region
       * was cut to this ratio already.
       *
       * `attention` crops towards whatever sharp thinks the subject is, which
       * is the difference between a group photograph and four foreheads — and
       * it is the fallback now rather than the rule. Where the caller has said
       * where to look, a strategy that looked somewhere else would overrule
       * them by however many pixels the rounding left over.
       */
      .resize({
        width: target.width,
        height: target.height,
        fit: 'cover',
        position: region ? 'centre' : 'attention',
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    /*
     * Anything sharp cannot decode: a file that is not an image, a
     * decompression bomb — and HEIC, on a build of libvips without libheif.
     * The caller treats this as "no cover" rather than as a failed event,
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
    // The shape goes with the key, because a card has to reserve the right
    // space before the image arrives — see the column's own note.
    .set({
      coverKey: key,
      coverAspect: coverAspect(size),
      /*
       * Written on every upload, including as nulls.
       *
       * A cover replaced from the camera roll has no photograph behind it and
       * the last one may have had — leaving the old row in place would reopen
       * the frame on a picture this cover was not made from, which is worse
       * than offering nothing.
       */
      coverPhotoId: from,
      coverX: framing?.x ?? null,
      coverY: framing?.y ?? null,
      coverZoom: framing?.zoom ?? null,
    })
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
    .set({
      coverKey: null,
      coverAspect: null,
      coverPhotoId: null,
      coverX: null,
      coverY: null,
      coverZoom: null,
    })
    .where(eq(schema.events.id, event.id));
  if (event.coverKey) await getStorage().delete(event.coverKey).catch(() => {});

  return NextResponse.json({ ok: true });
}
