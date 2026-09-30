/**
 * Re-stripping originals stored before the strip was complete — M7.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { crc32 } from '../src/crc32';
import { hasPrivateMetadata } from '../src/metadata';
import { LocalObjectStore } from '../src/objects';
import { readyPhotosAfter, restripOriginal } from '../src/pipeline';

const run = promisify(execFile);
const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: any;
let dir: string;
let objects: LocalObjectStore;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  dir = await mkdtemp(join(tmpdir(), 'restrip-test-'));
  objects = new LocalObjectStore(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "event", "photo" restart identity cascade`);
});

/** A JPEG as the old strip left it: no GPS, but a city and a named face. */
async function leaky(): Promise<Buffer> {
  const path = join(dir, `leaky-${crypto.randomUUID()}.jpg`);
  await writeFile(
    path,
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#48c' } }).jpeg().toBuffer(),
  );
  await run('exiftool', [
    '-overwrite_original', '-q',
    '-IPTC:City=Naxos',
    '-XMP-iptcExt:PersonInImage=Maya',
    '-DateTimeOriginal=2026:07:18 21:14:07',
    path,
  ]);
  return readFile(path);
}

async function stored(bytes: Buffer, status: 'ready' | 'quarantined' = 'ready') {
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
      status,
      mime: 'image/jpeg',
      crc32: crc32(bytes),
      byteSize: bytes.length,
    })
    .returning();
  return photo;
}

async function onDisk(key: string): Promise<string> {
  const path = join(dir, `check-${crypto.randomUUID()}`);
  await writeFile(path, (await objects.get(key))!);
  return path;
}

describe('restripOriginal', () => {
  it('removes the place and the name, in place, and fixes what describes the bytes', async () => {
    const photo = await stored(await leaky());
    expect(await hasPrivateMetadata(await onDisk(photo.storageKey))).toBe(true);

    expect(await restripOriginal({ db, objects }, photo.id)).toBe('restripped');

    expect(await hasPrivateMetadata(await onDisk(photo.storageKey))).toBe(false);
    const bytes = (await objects.get(photo.storageKey))!;
    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    // A zip download writes these into its headers; stale ones corrupt it.
    expect(row.byteSize).toBe(bytes.length);
    expect(row.crc32).toBe(crc32(bytes));
    // The date stays: the grid is chronological.
    const { stdout } = await run('exiftool', ['-s3', '-DateTimeOriginal', await onDisk(photo.storageKey)]);
    expect(stdout.trim()).toBe('2026:07:18 21:14:07');
  });

  it('leaves a clean original alone, so a second run writes nothing', async () => {
    const photo = await stored(await leaky());
    await restripOriginal({ db, objects }, photo.id);
    const before = await objects.get(photo.storageKey);
    expect(await restripOriginal({ db, objects }, photo.id)).toBe('clean');
    expect(await objects.get(photo.storageKey)).toEqual(before);
  });

  it('never rewrites a quarantined photo, which is evidence', async () => {
    const bytes = await leaky();
    const photo = await stored(bytes, 'quarantined');
    expect(await restripOriginal({ db, objects }, photo.id)).toBe('clean');
    expect(await objects.get(photo.storageKey)).toEqual(bytes);
  });
});

describe('readyPhotosAfter', () => {
  it('walks every ready photo once, in pages', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await stored(await leaky())).id);
    await stored(await leaky(), 'quarantined');

    const seen: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await readyPhotosAfter(db, after, 2);
      if (page.length === 0) break;
      seen.push(...page);
      after = page[page.length - 1]!;
    }
    expect(seen.sort()).toEqual(ids.sort());
  });
});
