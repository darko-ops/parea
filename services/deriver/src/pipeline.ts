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
import { and, desc, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { derivativeKey, formatsFor, type ImageFormat, type ImageKind } from '@parea/urls';

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
  DERIVATIVES,
  readDimensions,
  scanRendition,
  type DerivativeKind,
} from './derivatives';
import {
  hasPrivateMetadata,
  imageDataHash,
  stripAndVerify,
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
  /*
   * Only a photo still waiting to be processed is processed.
   *
   * This refused only `ready`, so a quarantined, removed or failed row ran the
   * whole pipeline again when asked — and asking was one call to `complete`,
   * which its uploader can make. A photo the scanner had quarantined could be
   * overwritten through its still-valid upload URL and re-derived into
   * `ready`, deleting the object the incident pointed at on the way. A hidden
   * or tombstoned row is the same question from the other side. Nothing is
   * written here: the row already says what happened to it.
   */
  if (photo.status !== 'pending' || photo.deletedAt || photo.hiddenAt) {
    return { status: 'failed', photoId, reason: `not_pending:${photo.status}` };
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

    // Hash, strip, check and read in one exiftool run — see `stripAndVerify`.
    // The pixel hashes prove the strip is metadata-only; null means exiftool
    // cannot hash this format, in which case there is nothing to compare.
    const outcome = await stripAndVerify(working);
    const { pixelsBefore, pixelsAfter, metadata } = outcome;

    if (outcome.stripError) {
      return fail(db, photoId, `strip_failed:${outcome.stripError.slice(0, 120)}`);
    }

    if (pixelsBefore && pixelsAfter && pixelsBefore !== pixelsAfter) {
      // "Pixel data is never re-encoded" is a promise to users about their
      // originals. If it ever stops being true, refuse the photo rather than
      // quietly degrade it.
      return fail(db, photoId, 'pixel_data_changed');
    }

    if (outcome.privateLeft) {
      // The strip reported success but a location or a person's name survived
      // — a format exiftool handles partially, or a check that could not read
      // the file. Serving it would break the guarantee on the privacy page.
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
      //
      // What is sent is what the provider takes: PhotoDNA reads no HEIC, so an
      // iPhone photo goes as a JPEG of itself — see `scanRendition`. A copy
      // that cannot be made is a scan that cannot be done, and waits like one.
      const sendable = scanner
        ? await scanRendition(stripped, photo.mime ?? 'application/octet-stream', scanner.limits).catch(
            (err: unknown) => {
              throw new ScanUnavailable(
                `no scan copy: ${err instanceof Error ? err.message : String(err)}`,
              );
            },
          )
        : null;
      const verdict =
        scanner && sendable
          ? await scanner.scan({ bytes: sendable.bytes, contentHash, mime: sendable.mime })
          : { match: false as const };
      if (verdict.match && scanner) {
        return quarantine(db, objects, photo, original, contentHash, {
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

    const dimensions = await readDimensions(stripped);

    /*
     * The original goes up while the sizes are made, not after.
     *
     * Deriving is CPU and the upload is network, so they overlap for free:
     * this used to be the whole upload's time added to every photo. Started
     * only here, after the child-safety check above has passed — the stripped
     * original must never land at its final key before that, or a matched
     * image would sit in storage outside the quarantine. A decode failure
     * below still waits for it and removes it, so a refused photo leaves no
     * object behind.
     */
    const finalKey = `ev/${photo.eventId}/${hex}`;
    const mime = metadata.mime ?? photo.mime;
    const originalUp = objects.put(finalKey, stripped, mime);
    // Never left unhandled: awaited below on success, or on failure.
    originalUp.catch(() => {});

    let derivatives;
    try {
      // JPEG only, so the photo appears as soon as it can. Its AVIF versions
      // are made when the deriver is idle — see `backfillAvif` — and until
      // then the image Worker answers an AVIF request with the JPEG.
      derivatives = await buildDerivatives(stripped, undefined, ['jpeg']);
    } catch (err) {
      // The common cause is a build of sharp without an HEVC decoder, which is
      // an operational fault rather than a bad photo — hence the boot probe.
      await originalUp.catch(() => {});
      await objects.delete(finalKey).catch(() => {});
      return fail(db, photoId, `decode_failed:${short(err)}`);
    }

    // Sibling keys, not `${finalKey}/${kind}` — that would make the original's
    // key a directory prefix as well as an object, which S3's flat namespace
    // tolerates and a filesystem does not. Shared with the URL layer so the
    // Worker resolves exactly what was written; a private copy of this rule
    // here would be a 404 nobody could explain.
    const keyOf = (d: { kind: DerivativeKind; format: ImageFormat }) =>
      derivativeKey(photo.eventId, hex, d.kind, d.format);

    /*
     * Together, because they are seven independent round trips to storage and
     * nothing downstream distinguishes the order they land in. One at a time
     * put seven latencies end to end into every photograph, on a deriver that
     * handles photographs one at a time — so it was seven round trips of the
     * whole queue's waiting, per photo, for no ordering anybody relies on.
     *
     * `Promise.all` rejects on the first failure, which is what is wanted and
     * is what the sequential loop did too: the throw leaves `processPhoto`
     * before the row is promoted to `ready`, so the photo stays `pending` and
     * the next poll has another go. The objects that did land are written over
     * by that attempt, because their keys come from the content hash.
     */
    await Promise.all([
      originalUp,
      ...derivatives.map((derivative) =>
        objects.put(keyOf(derivative), derivative.bytes, derivative.mime),
      ),
    ]);

    /*
     * `ready` and the rows that make it true, committed together.
     *
     * These were two statements, and the window between them was permanent
     * damage rather than a retry: `status` went to `ready` first, so a crash
     * before the derivative rows landed left a photo that every later attempt
     * refused to touch — the guard at the top of this function returns early
     * on `ready`, which is exactly what makes re-running safe and exactly what
     * makes this unrecoverable. The objects were in storage, the rows were
     * not, and the album quietly served originals for every size forever.
     *
     * Rare by hand and routine under retries, which is why it is worth fixing
     * before anything starts retrying on purpose: a scheduler turns "the
     * process happened to die in a 5ms window" into a thing that occurs.
     *
     * The uploads above stay outside. They are idempotent by construction —
     * the keys are content hashes, so a second attempt overwrites the same
     * bytes — and holding a transaction open across an object store is how a
     * slow network turns into held Postgres connections.
     */
    await db.transaction(async (tx: typeof db) => {
      await tx
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

      await tx
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
    });

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
 * The object is never re-encoded, renamed or deleted: destroying it would
 * destroy evidence subject to a preservation duty, and re-encoding it would
 * destroy its provenance. The photo row goes to `quarantined`, which no
 * listing, download or image URL will serve.
 *
 * And the bytes are copied, exactly as they arrived, to `preserved/`. The
 * upload key alone was not enough: its presigned PUT stays valid for fifteen
 * minutes, and scanning takes seconds, so the uploader could replace the only
 * copy with something innocuous of the same length before anyone looked. The
 * incident points at the copy, which nothing ever presigns.
 *
 * No report is filed from here. See docs/csam-runbook.md for why that is a
 * person's job.
 */
async function quarantine(
  db: any,
  objects: ObjectStore,
  photo: any,
  original: Buffer,
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

  const preservedKey = `preserved/photo/${photo.id}`;
  await objects.put(preservedKey, original, photo.mime ?? 'application/octet-stream');

  const [incident] = await db
    .insert(schema.safetyIncidents)
    .values({
      photoId: photo.id,
      eventId: photo.eventId,
      uploaderActorId: photo.uploaderId,
      provider: detection.provider,
      classification: detection.classification,
      providerReference: detection.providerReference ?? null,
      storageKey: preservedKey,
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

/**
 * Strip an original that was stored before the strip was complete — M7.
 *
 * Until 30 September 2026 the strip removed GPS coordinates and left the rest
 * of where a photo was taken (city, sub-location, "location shown") and the
 * names in its face regions. New uploads lose all of that; the ones already
 * stored kept it, and every viewer of an album can download originals. This
 * re-runs today's strip on one stored original, in place.
 *
 * In place, at the same key: the key and `content_hash` name the bytes as they
 * were first stored, and every image URL and derivative is addressed by that
 * hash, so moving the object would break all of them for no gain. What must
 * change is what describes the bytes exactly — `crc32` and `byte_size`, which
 * a zip download writes into its headers and which would otherwise produce a
 * corrupt archive. Derivatives are re-encoded by sharp and never carried the
 * metadata, so they are left alone.
 *
 * Only `ready` photos. A quarantined one is evidence and is never rewritten.
 * Idempotent: a clean original is read, checked and left untouched.
 */
export async function restripOriginal(
  { db, objects }: { db: any; objects: ObjectStore },
  photoId: string,
): Promise<'clean' | 'restripped' | 'failed'> {
  const [photo] = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.id, photoId))
    .limit(1);
  if (!photo || photo.status !== 'ready' || photo.deletedAt) return 'clean';

  const original = await objects.get(photo.storageKey);
  if (!original) return 'failed';

  const dir = await mkdtemp(join(tmpdir(), 'restrip-'));
  try {
    const working = join(dir, 'original');
    await writeFile(working, original);
    if (!(await hasPrivateMetadata(working))) return 'clean';

    const pixelsBefore = await imageDataHash(working);
    await stripPrivateMetadata(working);
    const pixelsAfter = await imageDataHash(working);
    // The same promise ingest keeps: metadata only, never the picture.
    if (pixelsBefore && pixelsAfter && pixelsBefore !== pixelsAfter) return 'failed';
    if (await hasPrivateMetadata(working)) return 'failed';

    const stripped = await readFile(working);
    await objects.put(photo.storageKey, stripped, photo.mime ?? 'application/octet-stream');
    await db
      .update(schema.photos)
      .set({ crc32: crc32(stripped), byteSize: stripped.length })
      .where(eq(schema.photos.id, photo.id));
    return 'restripped';
  } catch {
    return 'failed';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Ready photos in id order after `afterId`, for walking the whole table once. */
export async function readyPhotosAfter(
  db: any,
  afterId: string | null,
  limit = 100,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
        afterId ? sql`${schema.photos.id} > ${afterId}` : undefined,
      ),
    )
    .orderBy(schema.photos.id)
    .limit(limit);
  return rows.map((row: { id: string }) => row.id);
}

/** The sizes that have an AVIF version — see `formatsFor` in @parea/urls. */
const AVIF_KINDS = DERIVATIVES.map((d) => d.kind).filter((kind) =>
  formatsFor(kind as ImageKind).includes('avif'),
);

/**
 * Ready photos with a JPEG size whose AVIF version has not been made yet,
 * oldest first. Ingest makes JPEG only; these are what `backfillAvif` is for.
 */
export async function photosMissingAvif(db: any, limit = 20): Promise<string[]> {
  const kinds = sql.join(AVIF_KINDS.map((k) => sql`${k}`), sql`, `);
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
        isNotNull(schema.photos.contentHash),
        sql`exists (
          select 1 from "derivative" j
          where j.photo_id = ${schema.photos.id} and j.format = 'jpeg' and j.kind in (${kinds})
            and not exists (
              select 1 from "derivative" a
              where a.photo_id = j.photo_id and a.kind = j.kind and a.format = 'avif'
            )
        )`,
      ),
    )
    .orderBy(desc(schema.photos.uploadedAt))
    .limit(limit);
  return rows.map((r: { id: string }) => r.id);
}

/**
 * The AVIF versions of one ready photo's sizes — the half ingest leaves for
 * later. Reads the stored (stripped) original, encodes only the sizes that
 * have a JPEG and no AVIF yet, and records them; until it has, the image
 * Worker serves the JPEG in their place. Idempotent: rows are
 * `onConflictDoNothing` and the objects are keyed by content hash.
 */
export async function backfillAvif(
  { db, objects }: { db: any; objects: ObjectStore },
  photoId: string,
): Promise<'done' | 'skipped' | 'failed'> {
  const [photo] = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.id, photoId))
    .limit(1);
  if (!photo || photo.status !== 'ready' || !photo.contentHash) return 'skipped';

  const have = await db
    .select({ kind: schema.derivatives.kind, format: schema.derivatives.format })
    .from(schema.derivatives)
    .where(eq(schema.derivatives.photoId, photoId));
  const missing = AVIF_KINDS.filter(
    (kind) =>
      have.some((d: { kind: string; format: string }) => d.kind === kind && d.format === 'jpeg') &&
      !have.some((d: { kind: string; format: string }) => d.kind === kind && d.format === 'avif'),
  ) as DerivativeKind[];
  if (missing.length === 0) return 'skipped';

  const original = await objects.get(photo.storageKey);
  if (!original) return 'failed';
  const made = await buildDerivatives(original, missing, ['avif']).catch(() => null);
  if (!made || made.length === 0) return 'failed';

  const hex = photo.contentHash.toString('hex');
  await Promise.all(
    made.map((d) => objects.put(derivativeKey(photo.eventId, hex, d.kind, d.format), d.bytes, d.mime)),
  );
  await db
    .insert(schema.derivatives)
    .values(
      made.map((d) => ({
        photoId: photo.id,
        kind: d.kind,
        format: d.format,
        storageKey: derivativeKey(photo.eventId, hex, d.kind, d.format),
        width: d.width,
        height: d.height,
        mime: d.mime,
        byteSize: d.bytes.length,
      })),
    )
    .onConflictDoNothing();
  return 'done';
}
