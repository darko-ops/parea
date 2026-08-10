/**
 * The ingest pipeline — docs/design.md §7.5 step 5.
 *
 * One photo, start to finish: read the original, strip what should not be
 * kept, prove the pixels survived, extract what the grid needs, build
 * derivatives, move the object to a content-addressed key, and flip the row to
 * 'ready'.
 *
 * `status` is the gate the rest of the product depends on. Nothing is listed,
 * served or downloaded until it reaches 'ready', which means nothing is served
 * before its location metadata has been removed. If this stage fails, the
 * photo stays invisible rather than becoming visible in an unsafe state.
 */

import { schema } from '@parea/core';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crc32 } from './crc32';
import { buildDerivatives, readDimensions } from './derivatives';
import {
  extractMetadata,
  hasLocation,
  imageDataHash,
  stripPrivateMetadata,
} from './metadata';
import type { ObjectStore } from './objects';

export type PipelineDb = {
  select: any;
  update: any;
  insert: any;
};

export type Outcome =
  | { status: 'ready'; photoId: string; contentHash: string; derivatives: number }
  | { status: 'deduped'; photoId: string; contentHash: string }
  | { status: 'failed'; photoId: string; reason: string };

export type Deps = {
  db: any;
  objects: ObjectStore;
};

export async function processPhoto(
  { db, objects }: Deps,
  photoId: string,
): Promise<Outcome> {
  const [photo] = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.id, photoId))
    .limit(1);

  if (!photo) return { status: 'failed', photoId, reason: 'no_such_photo' };
  if (photo.status === 'ready') {
    return {
      status: 'ready',
      photoId,
      contentHash: photo.contentHash?.toString('hex') ?? '',
      derivatives: 0,
    };
  }

  const original = await objects.get(photo.storageKey);
  if (!original) return fail(db, photoId, 'object_missing');

  const dir = await mkdtemp(join(tmpdir(), 'deriver-'));
  try {
    const working = join(dir, 'original');
    await writeFile(working, original);

    // Prove the strip is metadata-only. Null means exiftool cannot hash this
    // format, in which case there is nothing to compare and we proceed.
    const pixelsBefore = await imageDataHash(working);

    try {
      await stripPrivateMetadata(working);
    } catch (err) {
      return fail(db, photoId, `strip_failed:${short(err)}`);
    }

    const pixelsAfter = await imageDataHash(working);
    if (pixelsBefore && pixelsAfter && pixelsBefore !== pixelsAfter) {
      // "Pixel data is never re-encoded" is a promise to users about their
      // originals. If it ever stops being true, refuse the photo rather than
      // quietly degrade it.
      return fail(db, photoId, 'pixel_data_changed');
    }

    if (await hasLocation(working)) {
      // The strip reported success but location survived — a format exiftool
      // handles partially. Serving it would break the guarantee in the UI.
      return fail(db, photoId, 'location_not_removed');
    }

    const stripped = await readFile(working);
    const contentHash = createHash('sha256').update(stripped).digest();
    const hex = contentHash.toString('hex');

    // First writer wins. The same photo forwarded and contributed by two
    // people collapses to one object; the loser is tombstoned rather than
    // rejected, so the uploader still sees their upload complete.
    const [existing] = await db
      .select()
      .from(schema.photos)
      .where(
        and(
          eq(schema.photos.eventId, photo.eventId),
          eq(schema.photos.contentHash, contentHash),
          ne(schema.photos.id, photo.id),
          isNull(schema.photos.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      await objects.delete(photo.storageKey).catch(() => {});
      await db
        .update(schema.photos)
        .set({ status: 'removed', deletedAt: new Date() })
        .where(eq(schema.photos.id, photo.id));
      return { status: 'deduped', photoId, contentHash: hex };
    }

    const metadata = await extractMetadata(working);
    const dimensions = await readDimensions(stripped);

    let derivatives;
    try {
      derivatives = await buildDerivatives(stripped);
    } catch (err) {
      // The common cause is a build of sharp without an HEVC decoder, which is
      // an operational fault rather than a bad photo — hence the boot probe.
      return fail(db, photoId, `decode_failed:${short(err)}`);
    }

    const finalKey = `ev/${photo.eventId}/${hex}`;
    const mime = metadata.mime ?? photo.mime;
    await objects.put(finalKey, stripped, mime);

    // Sibling keys, not `${finalKey}/${kind}` — that would make the original's
    // key a directory prefix as well as an object, which S3's flat namespace
    // tolerates and a filesystem does not.
    const derivativeKey = (kind: string) => `${finalKey}.${kind}.jpg`;

    for (const derivative of derivatives) {
      await objects.put(
        derivativeKey(derivative.kind),
        derivative.bytes,
        derivative.mime,
      );
    }

    await db
      .update(schema.photos)
      .set({
        storageKey: finalKey,
        contentHash,
        crc32: crc32(stripped),
        byteSize: stripped.length,
        mime,
        width: dimensions.width ?? metadata.width,
        height: dimensions.height ?? metadata.height,
        capturedAt: metadata.capturedAt,
        capturedOffsetMinutes: metadata.capturedOffsetMinutes,
        status: 'ready',
      })
      .where(eq(schema.photos.id, photo.id));

    await db
      .insert(schema.derivatives)
      .values(
        derivatives.map((d) => ({
          photoId: photo.id,
          kind: d.kind,
          storageKey: derivativeKey(d.kind),
          width: d.width,
          height: d.height,
          mime: d.mime,
        })),
      )
      .onConflictDoNothing();

    // Only once the row points at the new key. Deleting first would leave a
    // window where a crash loses the photo entirely.
    if (photo.storageKey !== finalKey) {
      await objects.delete(photo.storageKey).catch(() => {});
    }

    return {
      status: 'ready',
      photoId,
      contentHash: hex,
      derivatives: derivatives.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Photos awaiting ingest, oldest first. */
export async function pendingPhotoIds(db: any, limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(and(eq(schema.photos.status, 'pending'), isNull(schema.photos.deletedAt)))
    .orderBy(schema.photos.uploadedAt)
    .limit(limit);
  return rows.map((r: { id: string }) => r.id);
}

async function fail(db: any, photoId: string, reason: string): Promise<Outcome> {
  await db
    .update(schema.photos)
    .set({ status: 'failed' })
    .where(eq(schema.photos.id, photoId));
  return { status: 'failed', photoId, reason };
}

function short(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0]!.slice(0, 120);
}
