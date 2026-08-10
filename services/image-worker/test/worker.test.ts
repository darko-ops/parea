/**
 * The image Worker, with a fake R2 bucket and a fake edge cache.
 *
 * URL signing itself is covered in @parea/urls. What matters here is the
 * caching behaviour — the entire reason this component exists — and that a
 * bad URL never reaches storage.
 */

import { epochMarkerKey, signImagePath, type ImageRef } from '@parea/urls';
import { describe, expect, it, vi } from 'vitest';

import worker, { type Env } from '../src/index';

const SECRET = 'image-secret';
const EVENT = '3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const HASH = 'a'.repeat(64);
const ref: ImageRef = { eventId: EVENT, hash: HASH, kind: 'thumb', capEpoch: 1 };

function makeEnv(objects: Record<string, string> = {}) {
  const allReads: string[] = [];
  // Object reads only — the epoch marker is a separate, edge-cached lookup and
  // counting it would hide whether photo bytes were served from cache.
  const reads = {
    get length() {
      return allReads.filter((k) => !k.endsWith('/.epoch')).length;
    },
    all: allReads,
  };
  const env: Env = {
    IMAGE_SECRET: SECRET,
    BUCKET: {
      async get(key: string) {
        allReads.push(key);
        const value = objects[key];
        if (value === undefined) return null;
        const bytes = new TextEncoder().encode(value);
        return {
          size: bytes.byteLength,
          httpEtag: '"abc"',
          httpMetadata: { contentType: 'image/heic' },
          async text() { return value; },
          body: new ReadableStream<Uint8Array>({
            start(c) { c.enqueue(bytes); c.close(); },
          }),
        };
      },
    } as unknown as R2Bucket,
  };
  return { env, reads };
}

/** A cache keyed by URL, like the real one. */
function makeCache() {
  const store = new Map<string, Response>();
  const cache = {
    async match(req: Request) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req: Request, res: Response) {
      store.set(req.url, res);
    },
  };
  (globalThis as any).caches = { default: cache };
  return store;
}

const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;

async function fetchPath(env: Env, path: string, method = 'GET') {
  return worker.fetch(new Request(`https://img.example${path}`, { method }), env, ctx);
}

const OBJECTS = { [`ev/${EVENT}/${HASH}.thumb.jpg`]: 'thumbnail-bytes' };

describe('serving', () => {
  it('returns the object for a validly signed URL', async () => {
    makeCache();
    const { env } = makeEnv(OBJECTS);
    const res = await fetchPath(env, await signImagePath(SECRET, ref));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(await res.text()).toBe('thumbnail-bytes');
  });

  it('declares AVIF from the signed path, not from what R2 says', async () => {
    // The path is signed and the object's stored content type is not, so the
    // path is the one to trust. A mislabelled object must not make the Worker
    // tell a browser an AVIF is a JPEG — it would render nothing and there
    // would be no fallback left, because the browser already chose.
    makeCache();
    // The fake bucket reports `image/heic` for everything, which is exactly
    // the wrong answer here and the point of the assertion.
    const { env } = makeEnv({
      [`ev/${EVENT}/${HASH}.thumb.avif`]: 'avif-bytes',
    });
    const res = await fetchPath(env, await signImagePath(SECRET, { ...ref, format: 'avif' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/avif');
    expect(await res.text()).toBe('avif-bytes');
  });

  it('serves the two encodings of one thumbnail as two cache entries', async () => {
    // The property the whole format-in-the-path decision exists for. If these
    // shared an entry, one viewer's AVIF would be handed to the next viewer
    // whose browser cannot decode it.
    makeCache();
    const { env } = makeEnv({
      [`ev/${EVENT}/${HASH}.thumb.avif`]: 'avif-bytes',
      [`ev/${EVENT}/${HASH}.thumb.jpg`]: 'jpeg-bytes',
    });

    const avif = await fetchPath(env, await signImagePath(SECRET, { ...ref, format: 'avif' }));
    const jpeg = await fetchPath(env, await signImagePath(SECRET, { ...ref, format: 'jpeg' }));

    expect(await avif.text()).toBe('avif-bytes');
    expect(await jpeg.text()).toBe('jpeg-bytes');
  });

  it('keeps the stored content type for originals', async () => {
    // A HEIC original must not be relabelled as JPEG on the way out.
    makeCache();
    const { env } = makeEnv({ [`ev/${EVENT}/${HASH}`]: 'heic-bytes' });
    const res = await fetchPath(env, await signImagePath(SECRET, { ...ref, kind: 'orig' }));
    expect(res.headers.get('content-type')).toBe('image/heic');
  });

  it('sets headers that keep photos out of shared caches', async () => {
    makeCache();
    const { env } = makeEnv(OBJECTS);
    const res = await fetchPath(env, await signImagePath(SECRET, ref));

    const cacheControl = res.headers.get('cache-control')!;
    expect(cacheControl).toMatch(/^private/);
    expect(Number(/max-age=(\d+)/.exec(cacheControl)![1]))
      .toBeGreaterThan(0);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers HEAD without a body', async () => {
    makeCache();
    const { env } = makeEnv(OBJECTS);
    const res = await fetchPath(env, await signImagePath(SECRET, ref), 'HEAD');
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe('edge caching — the point of the component', () => {
  it('serves a second request without reading storage again', async () => {
    makeCache();
    const { env, reads } = makeEnv(OBJECTS);
    const path = await signImagePath(SECRET, ref);

    await (await fetchPath(env, path)).text();
    expect(reads.length).toBe(1);

    const second = await fetchPath(env, path);
    expect(await second.text()).toBe('thumbnail-bytes');
    expect(reads.length, 'the second request must not hit R2').toBe(1);
  });

  it('caches across viewers, because their URLs are identical', async () => {
    // Two people opening the same event within the hour produce the same URL,
    // so the second one is an edge hit. This is what makes a 200-thumbnail
    // grid affordable.
    makeCache();
    const { env, reads } = makeEnv(OBJECTS);

    const alice = await signImagePath(SECRET, ref, new Date('2026-07-18T14:03:11Z'));
    const bob = await signImagePath(SECRET, ref, new Date('2026-07-18T14:57:49Z'));
    expect(alice).toBe(bob);

    vi.setSystemTime(new Date('2026-07-18T14:58:00Z'));
    await (await fetchPath(env, alice)).text();
    await (await fetchPath(env, bob)).text();
    vi.useRealTimers();

    expect(reads.length).toBe(1);
  });

  it('looks the epoch up once per event, not once per photo', async () => {
    makeCache();
    const { env, reads } = makeEnv({
      [`ev/${EVENT}/${HASH}.thumb.jpg`]: 'one',
      [`ev/${EVENT}/${'b'.repeat(64)}.thumb.jpg`]: 'two',
    });
    await (await fetchPath(env, await signImagePath(SECRET, ref))).text();
    await (await fetchPath(env, await signImagePath(SECRET, { ...ref, hash: 'b'.repeat(64) }))).text();

    const epochReads = reads.all.filter((k) => k.endsWith('/.epoch'));
    expect(epochReads).toHaveLength(1);
  });

  it('never caches for longer than the URL is valid', async () => {
    // A cache entry outliving its URL would serve content whose signature has
    // expired, quietly defeating the expiry.
    makeCache();
    const { env } = makeEnv(OBJECTS);
    vi.setSystemTime(new Date('2026-07-18T14:59:00Z'));
    const path = await signImagePath(SECRET, ref);
    const res = await fetchPath(env, path);
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control')!)![1]);
    const expires = Number(new URL(`https://x${path}`).searchParams.get('e'));
    const remaining = expires - Math.floor(Date.now() / 1000);
    vi.useRealTimers();

    expect(maxAge).toBeLessThanOrEqual(remaining);
  });
});

describe('refusals', () => {
  it('does not touch storage for an unsigned URL', async () => {
    makeCache();
    const { env, reads } = makeEnv(OBJECTS);
    const res = await fetchPath(env, `/img/${EVENT}/${HASH}/thumb?v=1&e=99999999999&s=nope`);
    expect(res.status).toBe(404);
    expect(reads).toHaveLength(0);
  });

  it('reports an expired URL distinctly, so a client can re-mint', async () => {
    makeCache();
    const { env } = makeEnv(OBJECTS);
    const path = await signImagePath(SECRET, ref, new Date('2026-07-18T14:00:00Z'));
    const res = await fetchPath(env, path);
    expect(res.status).toBe(410);
  });

  it('gives the same answer for a missing object and a bad signature', async () => {
    makeCache();
    const { env } = makeEnv({});
    const missing = await fetchPath(env, await signImagePath(SECRET, ref));
    const forged = await fetchPath(env, `/img/${EVENT}/${HASH}/thumb?v=1&e=99999999999&s=x`);
    expect(missing.status).toBe(404);
    expect(forged.status).toBe(404);
    expect(await missing.text()).toBe(await forged.text());
  });

  it('revokes URLs minted before a rotation', async () => {
    // The point of the marker: an old URL verifies fine against its own epoch,
    // so only comparing against the event's current epoch can stop it.
    makeCache();
    const { env } = makeEnv({
      ...OBJECTS,
      [epochMarkerKey(EVENT)]: '2',
    });
    const stale = await signImagePath(SECRET, { ...ref, capEpoch: 1 });
    expect((await fetchPath(env, stale)).status).toBe(410);
  });

  it('still serves URLs minted after the rotation', async () => {
    makeCache();
    const { env } = makeEnv({ ...OBJECTS, [epochMarkerKey(EVENT)]: '2' });
    const fresh = await signImagePath(SECRET, { ...ref, capEpoch: 2 });
    expect((await fetchPath(env, fresh)).status).toBe(200);
  });

  it('revokes even a response already sitting in the edge cache', async () => {
    // Verification runs before the cache lookup precisely so that rotation
    // reaches cached responses; checking the cache first would serve them back.
    makeCache();
    const objects: Record<string, string> = { ...OBJECTS };
    const { env } = makeEnv(objects);
    const url = await signImagePath(SECRET, { ...ref, capEpoch: 1 });

    expect((await fetchPath(env, url)).status).toBe(200);
    objects[epochMarkerKey(EVENT)] = '2';
    makeCache(); // epoch lookups are edge-cached for a minute; skip that window

    expect((await fetchPath(env, url)).status).toBe(410);
  });

  it('treats a missing marker as never rotated', async () => {
    // No backfill for events created before rotation existed.
    makeCache();
    const { env } = makeEnv(OBJECTS);
    expect((await fetchPath(env, await signImagePath(SECRET, ref))).status).toBe(200);
  });

  it('refuses non-GET methods', async () => {
    makeCache();
    const { env } = makeEnv(OBJECTS);
    expect((await fetchPath(env, await signImagePath(SECRET, ref), 'DELETE')).status)
      .toBe(405);
  });
});
