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

import { recordModeration, REASON, schema } from '@parea/core';
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { derivativeKey, type ImageFormat } from '@parea/urls';

import { crc32 } from './crc32';
import {
  alertResponder,
  ScanUnavailable,
  type CsamScanner,
} from './safety';
import {
  ModerationUnavailable,
  type ContentModerator,
} from './moderation';
import {
  buildDerivatives,
  readDimensions,
  type DerivativeKind,
} from './derivatives';
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
  | { status: 'quarantined'; photoId: string; incidentId: string }
  | { status: 'failed'; photoId: string; reason: string };

export type Deps = {
  db: any;
  objects: ObjectStore;
  /** Null when no hash-matching provider is configured, which is allowed. */
  scanner: CsamScanner | null;
  /** Null when nothing classifies automatically, which is also allowed. */
  moderator?: ContentModerator | null;
};

export async function processPhoto(
  { db, objects, scanner, moderator }: Deps,
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

  // Terminal, and only safe to be terminal because of the gate in
  // `pendingPhotoIds`: nothing reaches here until storage has confirmed the
  // object or until long enough has passed that nothing is still coming. A
  // caller that reaches past that gate and hands over a freshly presigned id
  // will fail a photo that was about to arrive.
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
      // Not a moderation decision, but it is a photo that vanished after
      // someone uploaded it. Recorded so "where did mine go" has an answer
      // that is not silence.
      await recordModeration(db, {
        photoId: photo.id,
        eventId: photo.eventId,
        action: 'removed',
        actorId: null,
        reason: REASON.dedup,
      });
      return { status: 'deduped', photoId, contentHash: hex };
    }

    // Before derivatives, before publication, before anything is addressable.
    // A scanner outage leaves the photo pending and retryable rather than
    // letting it through — `ready` is the gate everything else keys off, so
    // failing closed here means unscanned content is never served.
    try {
      // Absent scanner: nothing to match against, and that is a stated posture
      // rather than a failure — see `postureFromEnv`. A photo is not held back
      // for the absence of a check nobody is running.
      const verdict = scanner
        ? await scanner.scan({ bytes: stripped, contentHash, mime: photo.mime })
        : { match: false as const };
      if (verdict.match && scanner) {
        return quarantine(db, objects, photo, contentHash, {
          provider: scanner.name,
          classification: verdict.classification,
          providerReference: verdict.providerReference,
        });
      }
      await classify(db, moderator ?? null, photo, stripped);
    } catch (err) {
      if (err instanceof ScanUnavailable) {
        // Deliberately not `fail()`: failed is terminal, and this photo is
        // innocent until something can check it. Left pending to retry.
        return { status: 'failed', photoId, reason: `scan_unavailable:${short(err)}` };
      }
      throw err;
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
    // tolerates and a filesystem does not. Shared with the URL layer so the
    // Worker resolves exactly what was written; a private copy of this rule
    // here would be a 404 nobody could explain.
    const keyOf = (d: { kind: DerivativeKind; format: ImageFormat }) =>
      derivativeKey(photo.eventId, hex, d.kind, d.format);

    for (const derivative of derivatives) {
      await objects.put(keyOf(derivative), derivative.bytes, derivative.mime);
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
          format: d.format,
          storageKey: keyOf(d),
          width: d.width,
          height: d.height,
          mime: d.mime,
          // Same reason the original records them (§10): "download as JPEG"
          // archives these objects, and an archive can only carry an exact
          // Content-Length if every member's size and CRC are known before
          // anything is read. The bytes are in hand here and nowhere else.
          byteSize: d.bytes.length,
          crc32: crc32(d.bytes),
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

/**
 * How long a photo may sit with its bytes unaccounted for before this looks
 * anyway.
 *
 * Presigned grants last 15 minutes, so nothing can still be arriving on the
 * original grant after that; a client that outlives its grant re-presigns,
 * which writes a new row and leaves this one orphaned. The extra margin is for
 * a client that uploaded successfully and then never got to call `complete` —
 * the tab was closed between the PUT and the confirmation, which is a second
 * or two of exposure per photo and therefore happens. Those rows are claimed
 * late rather than never, and the photo appears.
 */
const ARRIVAL_GRACE_MS = 30 * 60 * 1000;

/**
 * Photos awaiting ingest, oldest first — and only once their bytes are there.
 *
 * The gate is `bytesAt`, and it is the whole point of this function. A photo
 * row is created `pending` when the upload is *presigned*, which is before the
 * client has sent a single byte; `pending` is also this queue. So a watcher
 * polling every few seconds would claim rows mid-upload, find no object, and
 * `fail()` them — and failed is terminal. The bytes then land in storage, the
 * row is never looked at again, and the event shows nothing. Every photo
 * uploaded on this deployment between 19 and 23 August failed exactly that
 * way, with the objects sitting in R2 the whole time.
 *
 * `bytesAt` is written by `/api/uploads/<id>/complete` once storage has been
 * asked and has confirmed it holds the object, so a row carrying one is safe
 * to read. A row without one is not skipped forever, only until
 * `ARRIVAL_GRACE_MS` has passed — after that nothing is still coming, and
 * whatever is or is not in storage is the truth about this photo.
 */
export async function pendingPhotoIds(
  db: any,
  limit = 50,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.status, 'pending'),
        isNull(schema.photos.deletedAt),
        or(
          isNotNull(schema.photos.bytesAt),
          lt(schema.photos.uploadedAt, new Date(now.getTime() - ARRIVAL_GRACE_MS)),
        ),
      ),
    )
    .orderBy(schema.photos.uploadedAt)
    .limit(limit);
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Block it, keep it, tell a human — and nothing else.
 *
 * The object stays exactly where it is, unmoved and unmodified: no
 * content-addressed rename, no derivatives, no deletion. Destroying it would
 * destroy evidence subject to a preservation duty, and re-encoding it would
 * destroy its provenance. The photo row goes to `quarantined`, which no
 * listing, download or image URL will serve.
 *
 * No report is filed from here. See docs/csam-runbook.md for why that is a
 * person's job.
 */
async function quarantine(
  db: any,
  objects: ObjectStore,
  photo: any,
  contentHash: Buffer,
  detection: {
    provider: string;
    classification: string;
    providerReference?: string;
  },
): Promise<Outcome> {
  await db
    .update(schema.photos)
    .set({ status: 'quarantined', hiddenAt: new Date() })
    .where(eq(schema.photos.id, photo.id));

  const [incident] = await db
    .insert(schema.safetyIncidents)
    .values({
      photoId: photo.id,
      eventId: photo.eventId,
      uploaderActorId: photo.uploaderId,
      provider: detection.provider,
      classification: detection.classification,
      providerReference: detection.providerReference ?? null,
      storageKey: photo.storageKey,
      contentHash,
      // Open-ended until someone files: the purge job skips a null hold.
      preservationEndsAt: null,
    })
    .returning();

  await recordModeration(db, {
    photoId: photo.id,
    eventId: photo.eventId,
    action: 'quarantined',
    actorId: null,
    reason: REASON.csamScanner,
  });

  await alertResponder({
    incidentId: incident.id,
    eventId: photo.eventId,
    provider: detection.provider,
    classification: detection.classification,
  });

  return { status: 'quarantined', photoId: photo.id, incidentId: incident.id };
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

/**
 * Ask the classifier, write down what it said, and carry on regardless.
 *
 * Never quarantines and never fails the photo. A classifier is a probabilistic
 * opinion about ordinary adult content, and acting on one automatically would
 * take down swimwear at a rate no small team can review. The row exists so a
 * human queue has an order to work in.
 *
 * An outage is swallowed for the same reason. Failing closed on the CSAM
 * scanner is what keeps unscanned material from being served; failing closed
 * here would stop a birthday party because a third-party endpoint was slow,
 * and leave the photo in exactly the state it would have been in with no
 * classifier configured at all.
 */
async function classify(
  db: any,
  moderator: ContentModerator | null,
  photo: any,
  bytes: Buffer,
): Promise<void> {
  if (!moderator) return;
  try {
    const verdict = await moderator.review({ bytes, mime: photo.mime });
    if (!verdict.flagged) return;
    await db.insert(schema.moderationFlags).values({
      photoId: photo.id,
      eventId: photo.eventId,
      provider: moderator.name,
      labels: verdict.labels.join(','),
      score: verdict.score === undefined ? null : Math.round(verdict.score),
    });
  } catch (err) {
    console.error(
      `moderation failed for ${photo.id}:`,
      err instanceof ModerationUnavailable || err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Photographs that predate a derivative size, oldest first.
 *
 * `card` was added after the product had events in it, so every photograph
 * ingested before then has thumb, grid and full and nothing between. The web
 * app asks the `derivative` table before offering a `card` URL, so nothing is
 * broken in the meantime — this is what makes the answer yes for the ones
 * already there.
 *
 * Only `ready` photographs. A pending one is about to be derived anyway and
 * will get every size the current list names; a quarantined one is not
 * something to go back and make more copies of.
 */
export async function photosMissingDerivative(
  db: any,
  kind: DerivativeKind,
  limit = 100,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
        isNotNull(schema.photos.contentHash),
        sql`not exists (
          select 1 from "derivative" d
          where d.photo_id = ${schema.photos.id} and d.kind = ${kind}
        )`,
      ),
    )
    .orderBy(schema.photos.uploadedAt)
    .limit(limit);
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Encode one missing size for one photograph that already has the others.
 *
 * Deliberately not `processPhoto`. That one strips metadata, hashes, dedupes,
 * scans and republishes — the whole ingest — and running it again over a photo
 * that is already `ready` would re-scan content that has been scanned and
 * re-hash bytes whose hash is the object's own name. This reads the object
 * that is already stored, encodes the one size that is missing, and writes it.
 *
 * The original is the *stored* object, which is the stripped one: ingest
 * replaced the upload with it and `storage_key` points at it. So this produces
 * exactly what ingest would have, and never re-derives from something with
 * metadata still on it.
 *
 * Idempotent. `onConflictDoNothing` on the derivative row means two runs, or a
 * run that overlaps a re-ingest, cannot make a duplicate — the primary key is
 * (photo, kind, format).
 */
export async function backfillDerivative(
  { db, objects }: { db: any; objects: ObjectStore },
  photoId: string,
  kind: DerivativeKind,
): Promise<'done' | 'skipped' | 'failed'> {
  const [photo] = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.id, photoId))
    .limit(1);

  if (!photo || photo.status !== 'ready' || !photo.contentHash) return 'skipped';

  const original = await objects.get(photo.storageKey);
  if (!original) return 'failed';

  const hex = photo.contentHash.toString('hex');
  const made = await buildDerivatives(original, [kind]).catch(() => null);
  if (!made || made.length === 0) return 'failed';

  for (const derivative of made) {
    const key = derivativeKey(photo.eventId, hex, derivative.kind, derivative.format);
    await objects.put(key, derivative.bytes, derivative.mime);
    await db
      .insert(schema.derivatives)
      .values({
        photoId: photo.id,
        kind: derivative.kind,
        format: derivative.format,
        storageKey: key,
        width: derivative.width,
        height: derivative.height,
        mime: derivative.mime,
        byteSize: derivative.bytes.length,
      })
      .onConflictDoNothing();
  }

  return 'done';
}
