/**
 * The single exiftool run that replaces five — `stripAndVerify`.
 *
 * Against real files and the real exiftool: it must reach the same answers
 * the five separate calls did.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasPrivateMetadata, rebuildExif, stripAndVerify } from '../src/metadata';

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

/**
 * Breaks IFD0 the ways two real uploads had it broken: ImageDescription's value
 * pointed into the IFD itself, and (with `badFormat`) its last entry given
 * format 0, which exiftool reads past and will not write back.
 */
async function corruptIfd0(path: string, how: { overlap?: boolean; badFormat?: boolean }) {
  const bytes = await readFile(path);
  const tiff = bytes.indexOf('Exif\0\0') + 6;
  const le = bytes.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (at: number) => (le ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
  const put16 = (v: number, at: number) => (le ? bytes.writeUInt16LE(v, at) : bytes.writeUInt16BE(v, at));
  const put32 = (v: number, at: number) => (le ? bytes.writeUInt32LE(v, at) : bytes.writeUInt32BE(v, at));
  const ifd = tiff + (le ? bytes.readUInt32LE(tiff + 4) : bytes.readUInt32BE(tiff + 4));
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + 12 * k;
    if (how.overlap && u16(entry) === 0x010e) put32(ifd - tiff + 2, entry + 8);
    if (how.badFormat && k === count - 1) put16(0, entry + 2);
  }
  await writeFile(path, bytes);
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

  it('strips a photo whose IFD0 has a minor fault instead of failing it', async () => {
    // ImageDescription's value pointed into the IFD itself: exiftool calls
    // that "[minor] Suspicious IFD0 offset" and would not write without -m.
    const path = await photo('suspicious.jpg', [
      '-ImageDescription=A description longer than four bytes',
      '-GPSLatitude=40.7', '-GPSLatitudeRef=N',
    ]);
    await corruptIfd0(path, { overlap: true });

    const out = await stripAndVerify(path);
    expect(out.stripError).toBeNull();
    expect(out.privateLeft).toBe(false);
    expect(out.pixelsAfter).toBe(out.pixelsBefore);
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

describe('rebuildExif', () => {
  it('replaces an IFD0 the strip cannot write, keeping the date and orientation and not the place', async () => {
    const path = await photo('bad-format.jpg', [
      '-ImageDescription=A description longer than four bytes',
      '-DateTimeOriginal=2026:07:18 21:14:07',
      '-OffsetTimeOriginal=+03:00',
      '-Orientation#=6',
      '-Make=Apple',
      '-GPSLatitude=40.7', '-GPSLatitudeRef=N',
    ]);
    await corruptIfd0(path, { overlap: true, badFormat: true });

    const first = await stripAndVerify(path);
    expect(first.stripError).toMatch(/Bad format/);

    expect(await rebuildExif(path)).toBe(true);
    const out = await stripAndVerify(path);
    expect(out.stripError).toBeNull();
    expect(out.privateLeft).toBe(false);
    expect(out.pixelsAfter).toBe(first.pixelsBefore);
    expect(out.metadata.capturedAt?.toISOString()).toBe('2026-07-18T18:14:07.000Z');
    const { stdout } = await run('exiftool', ['-s3', '-n', '-Orientation', '-Make', '-GPSLatitude', path]);
    expect(stdout.trim().split('\n')).toEqual(['6', 'Apple']);
  });
});
