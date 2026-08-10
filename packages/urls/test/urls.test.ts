import { describe, expect, it } from 'vitest';

import {
  formatsFor,
  hourBucket,
  objectKeyFor,
  signImagePath,
  verifyImageRequest,
  type ImageRef,
} from '../src/index';

const SECRET = 'image-secret';
const EVENT = '3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const HASH = 'a'.repeat(64);

const ref: ImageRef = { eventId: EVENT, hash: HASH, kind: 'thumb', capEpoch: 1 };

function toUrl(path: string): URL {
  return new URL(path, 'https://img.example');
}

describe('cacheability — the reason this exists', () => {
  it('two viewers in the same hour generate byte-identical URLs', async () => {
    // If these differ, the edge cache hit rate is zero and every thumbnail is
    // an origin read forever. This is the property the whole design turns on.
    const alice = await signImagePath(SECRET, ref, new Date('2026-07-18T14:03:11Z'));
    const bob = await signImagePath(SECRET, ref, new Date('2026-07-18T14:57:49Z'));
    expect(alice).toBe(bob);
  });

  it('a naive expiry would not have that property', async () => {
    // Sanity check on the test above: different hours must differ, or the
    // equality is vacuous.
    const early = await signImagePath(SECRET, ref, new Date('2026-07-18T14:03:11Z'));
    const later = await signImagePath(SECRET, ref, new Date('2026-07-18T16:03:11Z'));
    expect(early).not.toBe(later);
  });

  it('rounds up, so a URL minted at :59 still lasts the full hour', async () => {
    const at = new Date('2026-07-18T14:59:59Z');
    const bucket = hourBucket(at);
    expect(bucket * 1000 - at.getTime()).toBeGreaterThanOrEqual(3600_000);
  });

  it('lands on exact hour boundaries', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-07-18T14:03:11Z', '2026-12-31T23:59:59Z']) {
      expect(hourBucket(new Date(iso)) % 3600).toBe(0);
    }
  });

  it('gives different photos and sizes different URLs', async () => {
    const thumb = await signImagePath(SECRET, ref);
    const grid = await signImagePath(SECRET, { ...ref, kind: 'grid' });
    const other = await signImagePath(SECRET, { ...ref, hash: 'b'.repeat(64) });
    expect(new Set([thumb, grid, other]).size).toBe(3);
  });
});

describe('verification', () => {
  it('accepts what it signed', async () => {
    const path = await signImagePath(SECRET, ref);
    const result = await verifyImageRequest(SECRET, toUrl(path));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // `format` is resolved rather than echoed: a ref that names no encoding
      // means jpeg, and the URL says so explicitly.
      expect(result.ref).toEqual({ ...ref, format: 'jpeg' });
    }
  });

  it('rejects a tampered signature', async () => {
    const path = await signImagePath(SECRET, ref);
    const result = await verifyImageRequest(SECRET, toUrl(`${path.slice(0, -2)}xy`));
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a URL signed with a different secret', async () => {
    const path = await signImagePath('other-secret', ref);
    expect(await verifyImageRequest(SECRET, toUrl(path))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('will not let the expiry be extended in the URL', async () => {
    const path = await signImagePath(SECRET, ref);
    const url = toUrl(path);
    url.searchParams.set('e', String(hourBucket(new Date()) + 86_400));
    expect(await verifyImageRequest(SECRET, url)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('will not let one photo be swapped for another', async () => {
    // The hash is in the signed payload, so pointing a valid signature at a
    // different object fails.
    const path = await signImagePath(SECRET, ref);
    const url = toUrl(path.replace(HASH, 'c'.repeat(64)));
    expect(await verifyImageRequest(SECRET, url)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('will not let a thumbnail URL be upgraded to the original', async () => {
    const path = await signImagePath(SECRET, ref);
    const url = toUrl(path.replace('/thumb.jpg?', '/orig.jpg?'));
    expect(await verifyImageRequest(SECRET, url)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired URL', async () => {
    const path = await signImagePath(SECRET, ref, new Date('2026-07-18T14:00:00Z'));
    const result = await verifyImageRequest(
      SECRET,
      toUrl(path),
      new Date('2026-07-18T17:00:00Z'),
    );
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed paths without touching storage', async () => {
    for (const path of [
      '/img/not-a-uuid/' + HASH + '/thumb?v=1&e=99999999999&s=x',
      `/img/${EVENT}/nothex/thumb?v=1&e=99999999999&s=x`,
      `/img/${EVENT}/${HASH}/enormous?v=1&e=99999999999&s=x`,
      `/img/${EVENT}/${HASH}?v=1&e=99999999999&s=x`,
      `/other/${EVENT}/${HASH}/thumb?v=1&e=1&s=x`,
      `/img/${EVENT}/${HASH}/thumb`,
    ]) {
      const result = await verifyImageRequest(SECRET, toUrl(path));
      expect(result, path).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('rejects a path traversal attempt in the hash', async () => {
    const url = toUrl(`/img/${EVENT}/..%2f..%2fsecret/thumb?v=1&e=9999999999&s=x`);
    expect((await verifyImageRequest(SECRET, url)).ok).toBe(false);
  });
});

describe('object keys', () => {
  it('matches the layout the deriver writes', () => {
    expect(objectKeyFor({ ...ref, kind: 'orig' })).toBe(`ev/${EVENT}/${HASH}`);
    expect(objectKeyFor({ ...ref, kind: 'thumb' })).toBe(`ev/${EVENT}/${HASH}.thumb.jpg`);
    expect(objectKeyFor({ ...ref, kind: 'grid' })).toBe(`ev/${EVENT}/${HASH}.grid.jpg`);
    expect(objectKeyFor({ ...ref, kind: 'full' })).toBe(`ev/${EVENT}/${HASH}.full.jpg`);
  });

  it('cannot produce a key outside the event prefix', async () => {
    // Everything reaching objectKeyFor has been through verification, which
    // constrains the hash to hex — but the key builder should not be the only
    // thing standing between a URL and someone else's object.
    const path = await signImagePath(SECRET, ref);
    const result = await verifyImageRequest(SECRET, toUrl(path));
    if (!result.ok) throw new Error('expected ok');
    expect(objectKeyFor(result.ref).startsWith(`ev/${EVENT}/`)).toBe(true);
    expect(objectKeyFor(result.ref)).not.toContain('..');
  });
});

describe('encodings — §11', () => {
  it('gives AVIF and JPEG different URLs, and so different cache entries', async () => {
    // The whole reason the format is in the path. If these collided, one
    // cached response would answer for viewers who disagree about AVIF.
    const avif = await signImagePath(SECRET, { ...ref, format: 'avif' });
    const jpeg = await signImagePath(SECRET, { ...ref, format: 'jpeg' });
    expect(avif).not.toBe(jpeg);
    expect(avif).toContain('/thumb.avif?');
    expect(jpeg).toContain('/thumb.jpg?');
  });

  it('still generates identical URLs per format for every viewer in the hour', async () => {
    // Splitting by format must not cost the property the design turns on.
    const a = await signImagePath(SECRET, { ...ref, format: 'avif' }, new Date('2026-07-18T14:03:11Z'));
    const b = await signImagePath(SECRET, { ...ref, format: 'avif' }, new Date('2026-07-18T14:57:49Z'));
    expect(a).toBe(b);
  });

  it('will not let a JPEG URL be edited into an AVIF one', async () => {
    // The signature covers the format, so swapping the extension is tampering
    // rather than a second valid request.
    const path = await signImagePath(SECRET, { ...ref, format: 'jpeg' });
    const url = toUrl(path.replace('/thumb.jpg?', '/thumb.avif?'));
    expect(await verifyImageRequest(SECRET, url)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an encoding that size does not have', async () => {
    // `full` is JPEG-only because it doubles as the download-as-JPEG archive
    // member. Asking for full.avif names an object nobody wrote.
    const path = await signImagePath(SECRET, { ...ref, kind: 'full' });
    const url = toUrl(path.replace('/full.jpg?', '/full.avif?'));
    expect(await verifyImageRequest(SECRET, url)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a URL with no extension at all', async () => {
    // The shape URLs had before formats existed. Accepting it with a jpeg
    // default would verify a signature over a format the caller never named.
    const path = await signImagePath(SECRET, ref);
    expect(await verifyImageRequest(SECRET, toUrl(path.replace('/thumb.jpg?', '/thumb?')))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('offers AVIF for the grid sizes and not for the archive one', async () => {
    expect(formatsFor('thumb')).toContain('avif');
    expect(formatsFor('grid')).toContain('avif');
    expect(formatsFor('full')).toEqual(['jpeg']);
    expect(formatsFor('orig')).toEqual(['jpeg']);
  });

  it('puts AVIF first, so the browser prefers it', async () => {
    expect(formatsFor('thumb')[0]).toBe('avif');
  });

  it('names the object the deriver wrote', async () => {
    expect(objectKeyFor({ ...ref, format: 'avif' })).toBe(
      `ev/${EVENT}/${HASH}.thumb.avif`,
    );
    expect(objectKeyFor({ ...ref, format: 'jpeg' })).toBe(
      `ev/${EVENT}/${HASH}.thumb.jpg`,
    );
    // The original is never re-encoded, so it has no suffix at all.
    expect(objectKeyFor({ ...ref, kind: 'orig', format: 'avif' })).toBe(
      `ev/${EVENT}/${HASH}`,
    );
  });
});
