/**
 * The ingest pipeline, end to end, with real image files and a real database.
 *
 * The assertions that matter here are promises the product makes to users:
 * location is gone, and the pixels are untouched. Both are checked against
 * actual bytes rather than against the code's belief about them.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { crc32 } from '../src/crc32';
import { backfillDerivative, photosMissingDerivative } from '../src/pipeline';
import { canDecode, canDecodeViaHeifConvert, canEncodeAvif } from '../src/derivatives';
import { HEVC_HEIC_SAMPLE } from '../src/fixture';
import { imageDataHash, parseExifDate, parseOffsetMinutes } from '../src/metadata';
import { LocalObjectStore } from '../src/objects';
import { MODERATORS, postureFromEnv } from '../src/moderation';
import { processPhoto } from '../src/pipeline';
import {
  ScanUnavailable,
  type CsamScanner,
} from '../src/safety';

const run = promisify(execFile);
const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: any;
let dir: string;
let objects: LocalObjectStore;
/** Clean by default; individual tests swap in a matching or broken scanner. */
/** No hash-matching provider, which is now a supported way to run. */
const scanner: CsamScanner | null = null;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  dir = await mkdtemp(join(tmpdir(), 'deriver-test-'));
  objects = new LocalObjectStore(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "code", "derivative", "device", "event",
      "event_participant", "group_member", "groups", "photo", "report"
    restart identity cascade
  `);
});

/** A JPEG carrying GPS, a capture time, a camera model and a serial number. */
async function geotaggedJpeg(seed = 1): Promise<Buffer> {
  const base = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 20 * seed, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  const path = join(dir, `src-${seed}.jpg`);
  await writeFile(path, base);
  await run('exiftool', [
    '-overwrite_original', '-q',
    '-GPSLatitude=51.5145', '-GPSLatitudeRef=N',
    '-GPSLongitude=-0.1270', '-GPSLongitudeRef=W',
    '-DateTimeOriginal=2026:07:18 21:14:07',
    '-OffsetTimeOriginal=+01:00',
    '-Make=Apple', '-Model=iPhone 15 Pro',
    '-SerialNumber=ABC123XYZ',
    '-OwnerName=Someone Real',
    path,
  ]);
  return readFile(path);
}

async function seedPhoto(bytes: Buffer, mime = 'image/jpeg') {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  const key = `ev/${event.id}/${crypto.randomUUID()}`;
  await objects.put(key, bytes);
  const [photo] = await db
    .insert(schema.photos)
    .values({
      eventId: event.id,
      uploaderId: actor.id,
      storageKey: key,
      byteSize: bytes.length,
      mime,
      status: 'pending',
    })
    .returning();
  return { actor, event, photo, key };
}

describe('the promises this makes to users', () => {
  it('removes location, and keeps the time and camera', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg());
    const outcome = await processPhoto({ db, objects, scanner }, photo.id);
    expect(outcome.status).toBe('ready');

    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, photo.id));

    const stored = await objects.get(row.storageKey);
    const path = join(dir, 'check.jpg');
    await writeFile(path, stored!);

    const { stdout } = await run('exiftool', [
      '-s3', '-GPSLatitude', '-GPSLongitude', '-SerialNumber', '-OwnerName', path,
    ]).catch(() => ({ stdout: '' }));
    expect(stdout.trim(), 'location and identifiers must be gone').toBe('');

    const { stdout: kept } = await run('exiftool', ['-s3', '-Model', path]);
    expect(kept.trim(), 'camera model is kept').toBe('iPhone 15 Pro');

    // The offset was +01:00, so 21:14:07 local is 20:14:07Z.
    expect(row.capturedAt.toISOString()).toBe('2026-07-18T20:14:07.000Z');
    expect(row.capturedOffsetMinutes).toBe(60);
  });

  it('does not re-encode the pixels', async () => {
    // The whole reason this is better than the group chat. Compares a hash of
    // the compressed image data only, ignoring metadata.
    const source = await geotaggedJpeg(2);
    const before = join(dir, 'before.jpg');
    await writeFile(before, source);
    const originalPixels = await imageDataHash(before);
    expect(originalPixels).toBeTruthy();

    const { photo } = await seedPhoto(source);
    await processPhoto({ db, objects, scanner }, photo.id);

    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, photo.id));
    const after = join(dir, 'after.jpg');
    await writeFile(after, (await objects.get(row.storageKey))!);

    expect(await imageDataHash(after)).toBe(originalPixels);
  });
});

describe('pipeline results', () => {
  it('moves the object to a content-addressed key and records the hash', async () => {
    const { photo, key } = await seedPhoto(await geotaggedJpeg(3));
    const outcome = await processPhoto({ db, objects, scanner }, photo.id);
    if (outcome.status !== 'ready') throw new Error(outcome.status);

    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, photo.id));

    expect(row.storageKey).toBe(`ev/${row.eventId}/${outcome.contentHash}`);
    expect(Buffer.from(row.contentHash).toString('hex')).toBe(outcome.contentHash);
    expect(await objects.get(key), 'the upload key is cleaned up').toBeNull();
    expect(row.status).toBe('ready');
    expect(row.width).toBe(800);
    expect(row.height).toBe(600);
  });

  it('stores a crc32 matching the stored bytes', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(4));
    await processPhoto({ db, objects, scanner }, photo.id);
    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, photo.id));
    const stored = await objects.get(row.storageKey);
    expect(row.crc32).toBe(crc32(stored!));
    expect(row.byteSize).toBe(stored!.length);
  });

  it('writes every size in every encoding, none larger than its bound', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(5));
    await processPhoto({ db, objects, scanner }, photo.id);

    const rows = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));

    // The three viewing sizes exist twice — AVIF for the browsers that can
    // decode it, JPEG for the ~6% that cannot. `full` does not: it is the
    // member of the "download as JPEG" archive and has to stay a JPEG.
    //
    // Written out rather than derived from DERIVATIVES on purpose. This is the
    // list the storage bill and the purge path both depend on, so adding a
    // size should fail here and be answered deliberately — which is what
    // happened when `card` arrived.
    expect(rows.map((r: any) => `${r.kind}.${r.format}`).sort()).toEqual([
      'card.avif',
      'card.jpeg',
      'full.jpeg',
      'grid.avif',
      'grid.jpeg',
      'thumb.avif',
      'thumb.jpeg',
    ]);

    for (const row of rows) {
      expect(await objects.get(row.storageKey), row.storageKey).not.toBeNull();
      const bound = { thumb: 320, card: 640, grid: 1280, full: 2560 }[row.kind as string]!;
      expect(Math.max(row.width, row.height)).toBeLessThanOrEqual(bound);
      // The key must be the one the Worker will ask for, extension included.
      expect(row.storageKey.endsWith(row.format === 'avif' ? '.avif' : '.jpg')).toBe(true);
    }
  });

  it('proves the AV1 encoder exists before trusting the format table', async () => {
    // What the boot probe asserts. `sharp.format.heif.output` is true for a
    // build with no AV1 encoder, exactly as it is true for one with no HEVC
    // decoder — so the probe encodes pixels and checks the brand.
    expect(await canEncodeAvif()).toBe(true);
  });

  it('writes AVIF that is actually AVIF', async () => {
    // libvips aliases avif onto its heif support, so a build with no AV1
    // encoder fails here rather than at the format table.
    const { photo } = await seedPhoto(await geotaggedJpeg(15));
    await processPhoto({ db, objects, scanner }, photo.id);

    const [row] = await db
      .select()
      .from(schema.derivatives)
      .where(
        and(
          eq(schema.derivatives.photoId, photo.id),
          eq(schema.derivatives.format, 'avif'),
        ),
      );
    const bytes = (await objects.get(row.storageKey))!;
    expect(bytes.subarray(4, 12).toString('latin1')).toBe('ftypavif');
    expect(row.mime).toBe('image/avif');
  });

  it('records size and CRC for every encoding, not only the JPEG', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(16));
    await processPhoto({ db, objects, scanner }, photo.id);

    const rows = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));

    for (const row of rows) {
      const bytes = (await objects.get(row.storageKey))!;
      expect(Number(row.byteSize), row.storageKey).toBe(bytes.length);
      expect(Number(row.crc32), row.storageKey).toBe(crc32(bytes));
    }
  });

  it('strips metadata from derivatives entirely', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(6));
    await processPhoto({ db, objects, scanner }, photo.id);
    const [thumb] = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));

    const path = join(dir, 'thumb.jpg');
    await writeFile(path, (await objects.get(thumb.storageKey))!);
    const { stdout } = await run('exiftool', [
      '-s3', '-GPSLatitude', '-Model', '-DateTimeOriginal', path,
    ]).catch(() => ({ stdout: '' }));
    expect(stdout.trim()).toBe('');
  });
});

describe('dedup', () => {
  it('collapses the same photo contributed twice, first writer wins', async () => {
    const bytes = await geotaggedJpeg(7);
    const first = await seedPhoto(bytes);
    const firstOutcome = await processPhoto({ db, objects, scanner }, first.photo.id);
    expect(firstOutcome.status).toBe('ready');

    // Same image, same event, different uploader.
    const [other] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const key = `ev/${first.event.id}/${crypto.randomUUID()}`;
    await objects.put(key, bytes);
    const [dup] = await db
      .insert(schema.photos)
      .values({
        eventId: first.event.id,
        uploaderId: other.id,
        storageKey: key,
        byteSize: bytes.length,
        mime: 'image/jpeg',
        status: 'pending',
      })
      .returning();

    const outcome = await processPhoto({ db, objects, scanner }, dup.id);
    expect(outcome.status).toBe('deduped');

    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, dup.id));
    expect(row.deletedAt).not.toBeNull();
    expect(await objects.get(key), 'the duplicate object is removed').toBeNull();

    // The survivor is untouched and still readable.
    const [kept] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, first.photo.id));
    expect(kept.status).toBe('ready');
    expect(await objects.get(kept.storageKey)).not.toBeNull();
  });

  it('is deterministic: identical input yields an identical hash', async () => {
    // Dedup depends on stripping being reproducible. If exiftool wrote
    // anything varying — a timestamp, a version — two copies of one photo
    // would hash differently and dedup would silently stop working.
    const bytes = await geotaggedJpeg(8);
    const a = await seedPhoto(bytes);
    const b = await seedPhoto(bytes); // different event, so no dedup
    const one = await processPhoto({ db, objects, scanner }, a.photo.id);
    const two = await processPhoto({ db, objects, scanner }, b.photo.id);
    if (one.status !== 'ready' || two.status !== 'ready') throw new Error('not ready');
    expect(one.contentHash).toBe(two.contentHash);
  });
});

describe('failure handling', () => {
  it('marks a photo failed when its object never arrived', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(9));
    await objects.delete(photo.storageKey);
    const outcome = await processPhoto({ db, objects, scanner }, photo.id);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'object_missing' });

    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    // Failed, not ready — nothing unprocessed becomes visible.
    expect(row.status).toBe('failed');
  });

  it('leaves an already-ready photo alone', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(10));
    await processPhoto({ db, objects, scanner }, photo.id);
    const outcome = await processPhoto({ db, objects, scanner }, photo.id);
    expect(outcome.status).toBe('ready');
  });

  it('reports a missing photo rather than throwing', async () => {
    const outcome = await processPhoto({ db, objects, scanner }, crypto.randomUUID());
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_such_photo' });
  });
});

describe('HEIC', () => {
  it('can decode real HEVC-coded HEIC by some route', async () => {
    // Guards the operational failure the boot probe exists for. Either sharp
    // decodes HEVC directly or the libheif fallback does; if neither, every
    // iPhone upload fails at ingest.
    const direct = await canDecode(HEVC_HEIC_SAMPLE);
    const fallback = direct || (await canDecodeViaHeifConvert(HEVC_HEIC_SAMPLE));
    expect(direct || fallback).toBe(true);
  });

  it('fills in a size that arrived after the photograph did', async () => {
    /*
     * `card` was added once the product already had albums in it, and the web
     * app asks the `derivative` table before offering one — so nothing breaks
     * without this, and nothing improves either. This is what makes the answer
     * yes for photographs that were already there.
     *
     * The setup is the real situation rather than a mock of it: ingest the
     * photo normally, then delete the `card` rows and objects to make it look
     * like one from before the size existed.
     */
    const { photo } = await seedPhoto(await geotaggedJpeg(6));
    await processPhoto({ db, objects, scanner }, photo.id);

    const cards = await db
      .select()
      .from(schema.derivatives)
      .where(
        and(eq(schema.derivatives.photoId, photo.id), eq(schema.derivatives.kind, 'card')),
      );
    expect(cards).toHaveLength(2);
    for (const row of cards) await objects.delete(row.storageKey);
    await db
      .delete(schema.derivatives)
      .where(
        and(eq(schema.derivatives.photoId, photo.id), eq(schema.derivatives.kind, 'card')),
      );

    expect(await photosMissingDerivative(db, 'card')).toEqual([photo.id]);

    expect(await backfillDerivative({ db, objects }, photo.id, 'card')).toBe('done');
    expect(await photosMissingDerivative(db, 'card')).toEqual([]);

    const after = await db
      .select()
      .from(schema.derivatives)
      .where(
        and(eq(schema.derivatives.photoId, photo.id), eq(schema.derivatives.kind, 'card')),
      );
    expect(after.map((r: any) => r.format).sort()).toEqual(['avif', 'jpeg']);
    for (const row of after) {
      expect(await objects.get(row.storageKey), row.storageKey).not.toBeNull();
      expect(Math.max(row.width, row.height)).toBeLessThanOrEqual(640);
    }
  });

  it('does not touch the sizes a photograph already has', async () => {
    // The backfill encodes one size. Re-running the whole pipeline would
    // re-scan content already scanned and rewrite objects whose names are
    // their own hashes.
    const { photo } = await seedPhoto(await geotaggedJpeg(7));
    await processPhoto({ db, objects, scanner }, photo.id);

    const before = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));

    // Nothing is missing, so there is nothing to do — and asking again is safe.
    expect(await photosMissingDerivative(db, 'card')).toEqual([]);
    expect(await backfillDerivative({ db, objects }, photo.id, 'card')).toBe('done');

    const after = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));
    expect(after).toHaveLength(before.length);
  });

  it('ingests a HEIC end to end', async () => {
    const { photo } = await seedPhoto(HEVC_HEIC_SAMPLE, 'image/heic');
    const outcome = await processPhoto({ db, objects, scanner }, photo.id);
    expect(outcome.status).toBe('ready');
    const rows = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));
    // Four sizes, two encodings for the three that are looked at on a screen.
    expect(rows).toHaveLength(7);
  });
});

describe('exif dates', () => {
  it('pins an instant when the camera recorded an offset', () => {
    expect(parseExifDate('2026:07:18 21:14:07', '+01:00')?.toISOString()).toBe(
      '2026-07-18T20:14:07.000Z',
    );
    expect(parseOffsetMinutes('+01:00')).toBe(60);
    expect(parseOffsetMinutes('-07:00')).toBe(-420);
  });

  it('falls back to UTC when it did not, and says so via a null offset', () => {
    expect(parseExifDate('2026:07:18 21:14:07', null)?.toISOString()).toBe(
      '2026-07-18T21:14:07.000Z',
    );
    expect(parseOffsetMinutes(null)).toBeNull();
  });

  it('does not invent a date from nonsense', () => {
    expect(parseExifDate(null, null)).toBeNull();
    expect(parseExifDate('0000:00:00 00:00:00', null)).toBeNull();
    expect(parseExifDate('not a date', null)).toBeNull();
  });
});

describe('crc32', () => {
  it('matches the known IEEE check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('child-safety scanning', () => {
  /** A scanner that matches everything, to exercise the quarantine path. */
  const matching: CsamScanner = {
    name: 'test-matcher',
    async scan() {
      return { match: true, classification: 'A1', providerReference: 'ref-123' };
    },
  };

  /** A scanner that cannot answer — an outage, not a clean result. */
  const broken: CsamScanner = {
    name: 'test-broken',
    async scan(): Promise<never> {
      throw new ScanUnavailable('provider unreachable');
    },
  };

  it('quarantines a match instead of publishing it', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(20));
    const outcome = await processPhoto({ db, objects, scanner: matching }, photo.id);
    expect(outcome.status).toBe('quarantined');

    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    expect(row.status).toBe('quarantined');
    expect(row.hiddenAt).not.toBeNull();
  });

  it('keeps the object rather than deleting it', async () => {
    // Deleting would destroy evidence under a preservation duty, and the
    // ordinary failure paths in this pipeline do delete.
    const { photo, key } = await seedPhoto(await geotaggedJpeg(21));
    await processPhoto({ db, objects, scanner: matching }, photo.id);
    expect(await objects.get(key), 'the original must survive').not.toBeNull();
  });

  it('builds no derivatives for quarantined content', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(22));
    await processPhoto({ db, objects, scanner: matching }, photo.id);
    const rows = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));
    expect(rows).toHaveLength(0);
  });

  it('records an incident a reviewer can act on months later', async () => {
    const { photo, event } = await seedPhoto(await geotaggedJpeg(23));
    const outcome = await processPhoto({ db, objects, scanner: matching }, photo.id);
    if (outcome.status !== 'quarantined') throw new Error('expected quarantine');

    const [incident] = await db
      .select()
      .from(schema.safetyIncidents)
      .where(eq(schema.safetyIncidents.id, outcome.incidentId));

    expect(incident.photoId).toBe(photo.id);
    expect(incident.eventId).toBe(event.id);
    expect(incident.uploaderActorId).toBe(photo.uploaderId);
    expect(incident.provider).toBe('test-matcher');
    expect(incident.classification).toBe('A1');
    expect(incident.providerReference).toBe('ref-123');
    expect(incident.storageKey).toBe(photo.storageKey);
    // Nothing has been filed, so the hold is open-ended and purge must skip it.
    expect(incident.reportedAt).toBeNull();
    expect(incident.preservationEndsAt).toBeNull();
  });

  it('never publishes a photo the scanner could not check', async () => {
    // Fails closed. An outage stalls ingest; it does not let content through.
    const { photo } = await seedPhoto(await geotaggedJpeg(24));
    const outcome = await processPhoto({ db, objects, scanner: broken }, photo.id);
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status === 'failed') {
      expect(outcome.reason).toMatch(/scan_unavailable/);
    }

    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    expect(row.status, 'anything but ready').not.toBe('ready');
  });

  it('scans before anything becomes addressable', async () => {
    // The content-addressed key is what image URLs are built from, so a match
    // must be caught before the object is moved there.
    const { photo, key } = await seedPhoto(await geotaggedJpeg(25));
    await processPhoto({ db, objects, scanner: matching }, photo.id);
    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    expect(row.storageKey).toBe(key);
  });
});

describe('the declared posture', () => {
  /**
   * What replaced the old acknowledgement flag.
   *
   * The previous gate refused to ingest anything without a CSAM scanner, so a
   * company that had not yet been approved for one — approval being gated on
   * vetting and a commercial agreement — could only launch by setting a flag
   * that said it was running unsafely. That made the honest posture and the
   * reckless one indistinguishable in the environment and in the logs.
   *
   * What has to be true now is that somebody decided. Not that they bought a
   * particular product.
   */
  it('refuses when nothing has been declared', () => {
    const { ok, detail } = postureFromEnv({});
    expect(ok).toBe(false);
    expect(detail).toMatch(/PAREA_MODERATION/);
  });

  it('refuses a value that is not one of the two', () => {
    expect(postureFromEnv({ PAREA_MODERATION: 'yes' }).ok).toBe(false);
    expect(postureFromEnv({ PAREA_MODERATION: 'true' }).ok).toBe(false);
  });

  it('accepts a declared human process', () => {
    // The posture of a small team at launch, and a legitimate one.
    expect(postureFromEnv({ PAREA_MODERATION: 'manual' }).ok).toBe(true);
  });

  it('will not take "automated" from a deployment with no classifier', () => {
    // Claiming automation you do not have is worse than claiming nothing.
    const { ok, detail } = postureFromEnv({ PAREA_MODERATION: 'automated' });
    expect(ok).toBe(false);
    expect(detail).toMatch(/MODERATOR_URL/);
  });

  it('accepts automation that is actually configured', () => {
    expect(
      postureFromEnv({
        PAREA_MODERATION: 'automated',
        MODERATOR_URL: 'https://example.test/review',
        MODERATOR_KEY: 'k',
      }).ok,
    ).toBe(true);
  });

  it('does not treat a hash scanner as a substitute for either', () => {
    // The two answer different questions. Having one says nothing about
    // whether anyone reviews the rest.
    expect(
      postureFromEnv({
        CSAM_SCANNER_URL: 'https://example.test/scan',
        CSAM_SCANNER_KEY: 'k',
      }).ok,
    ).toBe(false);
  });
});

describe('somewhere for an alert to go', () => {
  /**
   * The check exists because something can always quarantine. A child-safety
   * report does it with no scanner configured at all, so "we have no scanner"
   * is not a reason for nobody to be listening — and an alert destination that
   * is missing is only discovered at the incident, which is the worst possible
   * moment to discover it.
   */
  it('is not required outside production, where the image build runs', () => {
    // The Dockerfile probes at build time with no deployment environment.
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('is what the runbook means by an alert nobody sees', () => {
    // Stated as a test so deleting the check is a visible act rather than a
    // quiet one: docs/csam-runbook.md calls an unseen quarantine the same as
    // no scanning at all.
    const source = readFileSync(
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(/SAFETY_ALERT_WEBHOOK/);
    expect(source).toMatch(/SAFETY_ALERT_EMAIL/);
    expect(source).toMatch(/alertsRequired && !alertsGoSomewhere/);
  });
});

describe('a photo with no scanner configured', () => {
  it('still reaches ready', async () => {
    // The old behaviour was to stall it forever, which is what made the
    // absence of a commercial agreement into an inability to ship.
    const { photo } = await seedPhoto(await geotaggedJpeg(30));
    const outcome = await processPhoto({ db, objects, scanner: null }, photo.id);
    expect(outcome.status).toBe('ready');
  });

  it('opens no safety incident, because nothing detected anything', async () => {
    const { photo } = await seedPhoto(await geotaggedJpeg(31));
    await processPhoto({ db, objects, scanner: null }, photo.id);
    expect(await db.select().from(schema.safetyIncidents)).toHaveLength(0);
  });
});



/**
 * Reading a classifier's answer.
 *
 * Parsing is tested against recorded response shapes rather than a live
 * endpoint, because what breaks here is a provider changing its JSON, and a
 * mock of our own invention would agree with whatever we wrote.
 */
describe('what a classifier verdict means', () => {
  const sightengine = MODERATORS.sightengine!;

  it('flags explicit content above the threshold', () => {
    const verdict = sightengine.parse(
      { nudity: { sexual_activity: 0.94, suggestive: 0.02, none: 0.01 } },
      80,
    );
    expect(verdict.flagged).toBe(true);
    expect(verdict.labels).toEqual(['sexual_activity']);
    expect(verdict.score).toBe(94);
  });

  it('does not flag a swimming pool', () => {
    // `suggestive` is bikinis, cleavage and bare male chests. At an event
    // photo product that is a beach holiday, and flagging it would bury the
    // queue in the photos people are here to share.
    const verdict = sightengine.parse(
      { nudity: { suggestive: 0.97, sexual_activity: 0.01, none: 0.02 } },
      80,
    );
    expect(verdict.flagged).toBe(false);
    expect(verdict.labels).toEqual([]);
  });

  it('does not flag an explicit class below the threshold', () => {
    const verdict = sightengine.parse({ nudity: { erotica: 0.4, none: 0.6 } }, 80);
    expect(verdict.flagged).toBe(false);
  });

  it('reads an ordinary photo as clean', () => {
    const verdict = sightengine.parse(
      { nudity: { none: 0.99, sexual_activity: 0.001, suggestive: 0.004 } },
      80,
    );
    expect(verdict.flagged).toBe(false);
    expect(verdict.score).toBeUndefined();
  });

  it('treats a response it cannot read as clean rather than throwing', () => {
    // A parse error must not fail the photo: the classifier hides nothing, so
    // its worst outcome should be an unflagged photo, which is the same
    // position as having no classifier at all.
    expect(sightengine.parse({}, 80).flagged).toBe(false);
    expect(sightengine.parse({ nudity: null }, 80).flagged).toBe(false);
  });

  it('never counts `none` as a reason to flag', () => {
    // `none: 0.99` is the confidence that the photo is clean, and reading it
    // as a label would flag every ordinary photo at full confidence.
    expect(sightengine.parse({ nudity: { none: 0.99 } }, 80).labels).toEqual([]);
  });
});
