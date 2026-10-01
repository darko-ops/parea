/**
 * The single exiftool run that replaces five — `stripAndVerify`.
 *
 * Against real files and the real exiftool: it must reach the same answers
 * the five separate calls did.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasPrivateMetadata, stripAndVerify } from '../src/metadata';

const run = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'strip-verify-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function photo(name: string, tags: string[]): Promise<string> {
  const path = join(dir, name);
  await writeFile(
    path,
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#48c' } }).jpeg().toBuffer(),
  );
  if (tags.length) await run('exiftool', ['-overwrite_original', '-q', ...tags, path]);
  return path;
}

describe('stripAndVerify', () => {
  it('removes where and who, keeps the pixels and the date, in one run', async () => {
    const path = await photo('leaky.jpg', [
      '-GPSLatitude=40.7', '-GPSLatitudeRef=N', '-GPSLongitude=73.9', '-GPSLongitudeRef=W',
      '-IPTC:City=Naxos',
      '-XMP-iptcExt:PersonInImage=Maya',
      '-DateTimeOriginal=2026:07:18 21:14:07',
      '-OffsetTimeOriginal=+03:00',
    ]);
    const out = await stripAndVerify(path);

    expect(out.stripError).toBeNull();
    expect(out.privateLeft).toBe(false);
    expect(out.pixelsBefore).toBeTruthy();
    expect(out.pixelsAfter).toBe(out.pixelsBefore);
    expect(out.metadata.capturedAt?.toISOString()).toBe('2026-07-18T18:14:07.000Z');
    expect(out.metadata.width).toBe(64);
    expect(out.metadata.mime).toBe('image/jpeg');
    // And the file on disk agrees with the separate check.
    expect(await hasPrivateMetadata(path)).toBe(false);
  });

  it('answers a clean photo as clean', async () => {
    const out = await stripAndVerify(await photo('clean.jpg', []));
    expect(out.stripError).toBeNull();
    expect(out.privateLeft).toBe(false);
  });

  it('fails closed on a file exiftool cannot write', async () => {
    const path = join(dir, 'not-an-image.jpg');
    await writeFile(path, 'this is not a jpeg');
    const out = await stripAndVerify(path);
    expect(out.stripError).not.toBeNull();
  });

  it('fails closed when the file is not there at all', async () => {
    const out = await stripAndVerify(join(dir, 'missing.jpg'));
    expect(out.privateLeft).toBe(true);
    expect(out.stripError).not.toBeNull();
  });
});
