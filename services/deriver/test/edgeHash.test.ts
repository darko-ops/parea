/**
 * The Edge Hash wrapper, with Microsoft's library replaced by a stand-in: the
 * real one is never in the repository (see `src/edgeHash.ts`), and is checked
 * against Microsoft's test image by hand before it is switched on.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { EDGE_HASH_SCRIPT, edgeHasherFromEnv, lastEdgeHash, SdkEdgeHasher, type GenerateEdgeHashes } from '../src/edgeHash';

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } }).jpeg().toBuffer();
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png().toBuffer();
const scanInput = (bytes: Buffer) => ({ bytes, contentHash: Buffer.alloc(32), mime: 'image/jpeg' });

describe('the Edge Hash wrapper', () => {
  it('hands the library RGB pixels at their real size, and returns the last hash', async () => {
    const calls: { length: number; width: number; height: number; layout: string }[] = [];
    const generate: GenerateEdgeHashes = (pixels, width, height, layout) => {
      calls.push({ length: pixels.length, width, height, layout });
      return { count: 2, data: [{ PhotoDna: 'with-border' }, { PhotoDna: 'border-removed' }] };
    };
    const hasher = new SdkEdgeHasher(async () => generate);
    await expect(hasher.hash(scanInput(await jpeg(400, 300)))).resolves.toBe('border-removed');
    expect(calls).toEqual([{ length: 400 * 300 * 3, width: 400, height: 300, layout: 'RGB' }]);
  });

  it('drops alpha, so an image with transparency is still three bytes a pixel', async () => {
    let seen = 0;
    const hasher = new SdkEdgeHasher(async () => (pixels: Buffer) => {
      seen = pixels.length;
      return { count: 1, data: [{ PhotoDna: 'h' }] };
    });
    await hasher.hash(scanInput(await png(200, 200)));
    expect(seen).toBe(200 * 200 * 3);
  });

  it('loads the library once, and tries again after a failed load', async () => {
    let loads = 0;
    const generate: GenerateEdgeHashes = () => ({ count: 1, data: [{ PhotoDna: 'h' }] });
    const hasher = new SdkEdgeHasher(async () => {
      loads += 1;
      if (loads === 1) throw new Error('not yet');
      return generate;
    });
    const image = scanInput(await jpeg(200, 200));
    await expect(hasher.hash(image)).rejects.toThrow('not yet');
    await hasher.hash(image);
    await hasher.hash(image);
    expect(loads).toBe(2);
  });

  it('refuses an answer that holds no hash, rather than sending an empty one', () => {
    expect(() => lastEdgeHash({ count: 0, data: [] })).toThrow(/no edge hash/);
    expect(() => lastEdgeHash(null)).toThrow(/no edge hash/);
    expect(() => lastEdgeHash({ count: 1, data: [{ PhotoDna: '' }] })).toThrow(/no PhotoDna value/);
    expect(lastEdgeHash({ count: 1, data: [{ PhotoDna: 'abc' }] })).toBe('abc');
  });

  it('refuses something that is not an image', async () => {
    const hasher = new SdkEdgeHasher(async () => () => ({ count: 1, data: [{ PhotoDna: 'h' }] }));
    await expect(hasher.hash(scanInput(Buffer.from('not an image')))).rejects.toThrow();
  });
});

describe('edgeHasherFromEnv', () => {
  it('is off when the folder is not named', () => {
    expect(edgeHasherFromEnv({})).toBeNull();
    expect(edgeHasherFromEnv({ PHOTODNA_EDGEHASHGENERATOR: '  ' })).toBeNull();
  });

  it('refuses a folder without the library, rather than quietly sending images', () => {
    const empty = mkdtempSync(join(tmpdir(), 'pdna-'));
    expect(() => edgeHasherFromEnv({ PHOTODNA_EDGEHASHGENERATOR: empty })).toThrow(EDGE_HASH_SCRIPT);
  });

  it('builds a hasher when the folder has it, without loading it yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdna-'));
    // A placeholder file: only its presence is checked here; nothing runs it.
    writeFileSync(join(dir, EDGE_HASH_SCRIPT), '// placeholder\n');
    expect(edgeHasherFromEnv({ PHOTODNA_EDGEHASHGENERATOR: dir })).toBeInstanceOf(SdkEdgeHasher);
  });
});
