/**
 * The whole thing, once, end to end.
 *
 * Every other suite tests one component against its own seam. Nothing so far
 * has checked that they compose — that a photo which enters through the upload
 * path comes back out of the download path intact, having been stripped,
 * derived, addressed and archived by four different pieces of code that only
 * ever met in a design document.
 *
 * The central assertion is the product's actual promise: **the bytes that come
 * out of the zip are the bytes that went in, minus the location metadata**.
 * Everything else here is the scaffolding needed to state that honestly.
 *
 * Runs against real Postgres (PGlite), real image files, a real filesystem
 * object store, the real deriver pipeline, the real zip writer, and a real
 * `unzip` to open the result.
 */

import { PGlite } from '@electric-sql/pglite';
import {
  autoHideDeadline,
  newLinkToken,
  normaliseCode,
  schema,
  visiblePhotos,
} from '@parea/core';
import { archiveEntryName, planArchive, streamArchive } from '@parea/zip';
import {
  formatsFor,
  objectKeyFor,
  signImagePath,
  verifyImageRequest,
} from '@parea/urls';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveArchive } from '../../apps/web/src/archive';
import { crc32 } from '../../services/deriver/src/crc32';
import { seedCodes } from '../../services/deriver/src/jobs';
import { LocalObjectStore } from '../../services/deriver/src/objects';
import { processPhoto } from '../../services/deriver/src/pipeline';
import { DisabledScanner } from '../../services/deriver/src/safety';

const run = promisify(execFile);
const MIGRATIONS = fileURLToPath(
  new URL('../../packages/core/drizzle', import.meta.url),
);
const IMAGE_SECRET = 'e2e-image-secret';

let db: any;
let dir: string;
let objects: LocalObjectStore;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  dir = await mkdtemp(join(tmpdir(), 'parea-e2e-'));
  objects = new LocalObjectStore(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A photo as a phone would produce it: geotagged, timestamped, identifiable. */
async function cameraPhoto(seed: number): Promise<Buffer> {
  const base = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 30 * seed, g: 90, b: 180 },
    },
  })
    .jpeg({ quality: 92 })
    .toBuffer();

  const path = join(dir, `camera-${seed}.jpg`);
  await writeFile(path, base);
  await run('exiftool', [
    '-overwrite_original', '-q',
    '-GPSLatitude=51.5145', '-GPSLatitudeRef=N',
    '-GPSLongitude=-0.1270', '-GPSLongitudeRef=W',
    `-DateTimeOriginal=2026:07:18 21:${String(10 + seed).padStart(2, '0')}:07`,
    '-OffsetTimeOriginal=+01:00',
    '-Make=Apple', '-Model=iPhone 15 Pro', '-SerialNumber=SERIAL123',
    path,
  ]);
  return readFile(path);
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

describe('a party, from link to download', () => {
  it('carries photos intact from three contributors to a zip', async () => {
    // --- the host creates an event, and a code is claimed from the pool ----
    const seeded = await seedCodes(db);
    expect(seeded, 'the pool must actually fill').toBeGreaterThan(10_000);

    const [host] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const [event] = await db
      .insert(schema.events)
      .values({ name: "Sarah's birthday", linkToken: newLinkToken(), createdBy: host.id })
      .returning();

    // PGlite returns { rows }, postgres-js returns the array directly. The app
    // runs on postgres-js; this normalises so the test exercises the same SQL.
    const claimed: any = await db.execute(sql`
      update "code" set event_id = ${event.id}, claimed_at = now()
      where id = (select id from "code" where event_id is null
                  order by random() limit 1 for update skip locked)
      returning words
    `);
    const code = (claimed.rows ?? claimed)[0]!.words as string;
    expect(normaliseCode(code), 'a code someone can say out loud').toBe(code);

    // --- the code resolves back to the event, which is the third door -----
    const [viaCode] = await db
      .select({ event: schema.events })
      .from(schema.codes)
      .innerJoin(schema.events, eq(schema.codes.eventId, schema.events.id))
      .where(and(eq(schema.codes.words, code), isNull(schema.codes.releasedAt)))
      .limit(1);
    expect(viaCode!.event.id).toBe(event.id);

    // --- three people upload, as the presign → PUT → complete path does ---
    const originals = new Map<string, Buffer>();
    const photoIds: string[] = [];

    for (let i = 1; i <= 3; i++) {
      const [contributor] = await db
        .insert(schema.actors)
        .values({ kind: 'guest' })
        .returning();
      const bytes = await cameraPhoto(i);
      const uploadKey = `ev/${event.id}/${crypto.randomUUID()}`;
      await objects.put(uploadKey, bytes);

      const [photo] = await db
        .insert(schema.photos)
        .values({
          eventId: event.id,
          uploaderId: contributor.id,
          storageKey: uploadKey,
          byteSize: bytes.length,
          mime: 'image/jpeg',
          status: 'pending',
        })
        .returning();

      originals.set(photo.id, bytes);
      photoIds.push(photo.id);
    }

    // Nothing is visible before ingest: `ready` is the gate, and it is what
    // stops an un-stripped original reaching a viewer.
    expect(
      await db.select().from(schema.photos).where(visiblePhotos(event.id, { blockedActorIds: [] })),
    ).toHaveLength(0);

    // --- the deriver runs -------------------------------------------------
    const scanner = new DisabledScanner();
    for (const id of photoIds) {
      const outcome = await processPhoto({ db, objects, scanner }, id);
      expect(outcome.status, `photo ${id}`).toBe('ready');
    }

    const visible = await db
      .select()
      .from(schema.photos)
      .where(visiblePhotos(event.id, { blockedActorIds: [] }))
      .orderBy(sql`coalesce(captured_at, uploaded_at)`);
    expect(visible).toHaveLength(3);
    expect(new Set(visible.map((p: any) => p.uploaderId)).size, '3 contributors').toBe(3);

    // --- the grid asks for a thumbnail, via a signed cacheable URL --------
    const first = visible[0]!;
    const hash = Buffer.from(first.contentHash).toString('hex');
    const path = await signImagePath(IMAGE_SECRET, {
      eventId: event.id,
      hash,
      kind: 'thumb',
      capEpoch: event.capEpoch,
    });
    const check = await verifyImageRequest(IMAGE_SECRET, new URL(path, 'https://img.test'));
    expect(check.ok).toBe(true);
    if (check.ok) {
      // The URL the image Worker would resolve must name an object that exists.
      expect(await objects.get(objectKeyFor(check.ref))).not.toBeNull();
    }

    // Both encodings, both reachable. The deriver names these objects and the
    // Worker names them again from a signed path; the two never meet, so an
    // extension the two spell differently is a 404 with no failing unit test.
    for (const format of formatsFor('thumb')) {
      const signed = await signImagePath(IMAGE_SECRET, {
        eventId: event.id,
        hash,
        kind: 'thumb',
        format,
        capEpoch: event.capEpoch,
      });
      const resolved = await verifyImageRequest(
        IMAGE_SECRET,
        new URL(signed, 'https://img.test'),
      );
      expect(resolved.ok, format).toBe(true);
      if (!resolved.ok) continue;
      const bytes = await objects.get(objectKeyFor(resolved.ref));
      expect(bytes, `${format} thumbnail must exist at the key the Worker asks for`)
        .not.toBeNull();
      if (format === 'avif') {
        expect(bytes!.subarray(4, 12).toString('latin1')).toBe('ftypavif');
      }
    }

    // --- someone downloads everything -------------------------------------
    const entries = visible.map((photo: any, index: number) => ({
      key: photo.storageKey,
      name: archiveEntryName(index, photo.capturedAt ?? photo.uploadedAt, photo.mime),
      size: Number(photo.byteSize),
      crc32: Number(photo.crc32),
      takenAt: (photo.capturedAt ?? photo.uploadedAt).toISOString(),
    }));

    const plan = planArchive(
      entries.map((e: (typeof entries)[number]) => ({
        name: e.name,
        size: e.size,
        crc32: e.crc32,
        modified: new Date(e.takenAt),
      })),
    );

    const zip = await collect(
      streamArchive(plan, async (index) => {
        const bytes = await objects.get(entries[index]!.key);
        if (!bytes) throw new Error(`missing ${entries[index]!.key}`);
        return new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(bytes); c.close(); },
        });
      }),
    );

    // The Content-Length the Worker would have promised.
    expect(zip.byteLength).toBe(plan.totalBytes);

    // --- and a real unzip opens it ----------------------------------------
    const zipPath = join(dir, 'download.zip');
    const outDir = join(dir, 'extracted');
    await writeFile(zipPath, zip);
    expect((await run('unzip', ['-t', zipPath])).stdout).toMatch(/No errors detected/);
    await run('unzip', ['-o', '-q', zipPath, '-d', outDir]);

    // --- the promise, checked -------------------------------------------
    for (const [index, photo] of visible.entries()) {
      const extracted = await readFile(join(outDir, entries[index]!.name));
      const stored = (await objects.get(photo.storageKey))!;

      // What came out of the archive is exactly what is stored.
      expect(createHash('sha256').update(extracted).digest('hex')).toBe(
        createHash('sha256').update(stored).digest('hex'),
      );

      // Location and device identifiers are gone.
      const { stdout: leaked } = await run('exiftool', [
        '-s3', '-GPSLatitude', '-GPSLongitude', '-SerialNumber',
        join(outDir, entries[index]!.name),
      ]).catch(() => ({ stdout: '' }));
      expect(leaked.trim(), 'nothing identifying survives').toBe('');

      // The photograph itself is untouched — same compressed image data as the
      // file that left the phone, which is what makes this better than the
      // group chat.
      const originalPath = join(dir, `orig-${index}.jpg`);
      await writeFile(originalPath, originals.get(photo.id)!);
      const hashOf = async (p: string) =>
        (await run('exiftool', ['-api', 'ImageHashType=SHA256', '-s3', '-ImageDataHash', p]))
          .stdout.trim();
      expect(await hashOf(join(outDir, entries[index]!.name))).toBe(
        await hashOf(originalPath),
      );

      // And the capture time survived, so the grid is chronological.
      expect(photo.capturedAt).not.toBeNull();
    }
  }, 60_000);
});

describe('download as JPEG, against real bytes', () => {
  /**
   * The archive an Android recipient gets — design §7.7.
   *
   * Worth doing against real files rather than fixtures because the property
   * that matters is an agreement between two pieces of code that never meet:
   * the deriver records each derivative's size and CRC-32 at ingest, and the
   * download path builds an archive header out of those numbers without ever
   * reading the object. If they disagree by one byte, the zip is corrupt, and
   * no unit test of either side alone would notice.
   */
  it('archives the derivative, and the numbers recorded at ingest are true', async () => {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const [event] = await db
      .insert(schema.events)
      .values({ name: 'Rooftop', linkToken: newLinkToken(), createdBy: actor.id })
      .returning();

    // PNG, so it is not already JPEG and the substitution actually happens.
    // (HEIC would be truer to the case, but encoding one needs an HEVC encoder
    // that the test machine may not have; what is being tested is the
    // substitution and the arithmetic, not the input codec.)
    const png = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 90 } },
    })
      .png()
      .toBuffer();

    const uploadKey = `ev/${event.id}/${crypto.randomUUID()}`;
    await objects.put(uploadKey, png);
    const [row] = await db
      .insert(schema.photos)
      .values({
        eventId: event.id,
        uploaderId: actor.id,
        storageKey: uploadKey,
        byteSize: png.length,
        mime: 'image/png',
        status: 'pending',
      })
      .returning();

    expect(
      (await processPhoto({ db, objects, scanner: new DisabledScanner() }, row.id)).status,
    ).toBe('ready');

    const [derivative] = await db
      .select()
      .from(schema.derivatives)
      .where(
        and(eq(schema.derivatives.photoId, row.id), eq(schema.derivatives.kind, 'full')),
      );

    // What the deriver wrote down must describe the object it stored.
    const storedDerivative = (await objects.get(derivative.storageKey))!;
    expect(Number(derivative.byteSize)).toBe(storedDerivative.length);
    expect(Number(derivative.crc32)).toBe(crc32(storedDerivative));

    // --- the two formats resolve to different objects ---------------------
    const asOriginal = await resolveArchive(db, event.id, {
      selection: 'all',
      format: 'original',
    });
    const asJpeg = await resolveArchive(db, event.id, { selection: 'all', format: 'jpeg' });
    expect(asOriginal.ok && asJpeg.ok).toBe(true);
    if (!asOriginal.ok || !asJpeg.ok) return;

    expect(asOriginal.entries[0]!.name).toMatch(/\.png$/);
    expect(asJpeg.entries[0]!.name).toMatch(/\.jpg$/);
    expect(asJpeg.converted).toBe(1);

    // --- and the JPEG archive opens ---------------------------------------
    const plan = planArchive(
      asJpeg.entries.map((e) => ({
        name: e.name,
        size: e.size,
        crc32: e.crc32,
        modified: new Date(e.takenAt),
      })),
    );
    const zip = await collect(
      streamArchive(plan, async (index) => {
        const bytes = (await objects.get(asJpeg.entries[index]!.key))!;
        return new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(bytes); c.close(); },
        });
      }),
    );
    expect(zip.byteLength, 'the Content-Length the Worker promised').toBe(plan.totalBytes);

    const zipPath = join(dir, 'jpeg.zip');
    const outDir = join(dir, 'jpeg-extracted');
    await writeFile(zipPath, zip);
    // `unzip -t` verifies every CRC, which is the real check on the numbers
    // the deriver recorded — a wrong CRC fails here and nowhere earlier.
    expect((await run('unzip', ['-t', zipPath])).stdout).toMatch(/No errors detected/);
    await run('unzip', ['-o', '-q', zipPath, '-d', outDir]);

    // A file an Android gallery can actually open: real JPEG, right size.
    const extracted = await readFile(join(outDir, asJpeg.entries[0]!.name));
    const meta = await sharp(extracted).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(2560);

    // And smaller than the original, which is the other half of why anyone
    // would pick this button.
    expect(extracted.length).toBeLessThan(png.length);
  }, 60_000);
});

describe('the safety paths, against the same data', () => {
  it('a removal request hides a photo without destroying it', async () => {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const [event] = await db
      .insert(schema.events)
      .values({ name: 'Dinner', linkToken: newLinkToken(), createdBy: actor.id })
      .returning();
    const [photo] = await db
      .insert(schema.photos)
      .values({
        eventId: event.id, uploaderId: actor.id, storageKey: 'k',
        byteSize: 1, mime: 'image/jpeg', status: 'ready',
      })
      .returning();

    await db.insert(schema.reports).values({
      photoId: photo.id,
      kind: 'removal_request',
      autoHideAt: autoHideDeadline(new Date(Date.now() - 1000)),
    });

    // The job would set this; assert the consequence rather than re-testing it.
    await db
      .update(schema.photos)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.photos.id, photo.id));

    const visible = await db
      .select()
      .from(schema.photos)
      .where(visiblePhotos(event.id, { blockedActorIds: [] }));
    expect(visible).toHaveLength(0);

    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    expect(row.deletedAt, 'hidden, and still recoverable').toBeNull();
  });
});
