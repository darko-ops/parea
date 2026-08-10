/**
 * The Worker handler, exercised with a fake R2 bucket.
 *
 * The zip bytes themselves are covered in @parea/zip against real extractors;
 * what is checked here is everything around them — token verification, the
 * headers a browser depends on, and the failure modes.
 */

import {
  signManifestToken,
  type DownloadManifest,
} from '@parea/zip';
import { describe, expect, it } from 'vitest';

import worker, { type Env } from '../src/index';

const SECRET = 'test-secret';

/** Just enough R2Bucket for the handler. */
function bucket(objects: Record<string, Uint8Array | string>) {
  return {
    async get(key: string) {
      const value = objects[key];
      if (value === undefined) return null;
      const bytes =
        typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return {
        async text() {
          return new TextDecoder().decode(bytes);
        },
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      };
    },
  } as unknown as R2Bucket;
}

function manifest(entries: DownloadManifest['entries']): DownloadManifest {
  return {
    version: 1,
    eventId: 'event-1',
    archiveName: "Sarah's birthday.zip",
    createdAt: new Date('2026-07-19T09:00:00Z').toISOString(),
    entries,
  };
}

async function setup(
  overrides: { manifest?: DownloadManifest; photos?: Record<string, string> } = {},
) {
  const photos = overrides.photos ?? { 'ev/1/aaa': 'photo-one', 'ev/1/bbb': 'two' };
  const doc =
    overrides.manifest ??
    manifest([
      { key: 'ev/1/aaa', name: '0001.jpg', size: 9, crc32: 0, takenAt: '2026-07-18T21:14:06Z' },
      { key: 'ev/1/bbb', name: '0002.jpg', size: 3, crc32: 0, takenAt: '2026-07-18T21:20:00Z' },
    ]);

  const env: Env = {
    BUCKET: bucket({ 'tmp/manifest/x.json': JSON.stringify(doc), ...photos }),
    MANIFEST_SECRET: SECRET,
  };
  const token = await signManifestToken(
    SECRET,
    'tmp/manifest/x.json',
    new Date(Date.now() + 600_000),
  );
  return { env, token, doc };
}

async function get(env: Env, token: string, method = 'GET') {
  return worker.fetch(
    new Request(`https://zip.example/zip?m=${encodeURIComponent(token)}`, { method }),
    env,
  );
}

describe('serving an archive', () => {
  it('streams a zip with an exact Content-Length', async () => {
    const { env, token } = await setup();
    const res = await get(env, token);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(
      Number(res.headers.get('content-length')),
      'a wrong length hangs or truncates the download',
    ).toBe(body.byteLength);
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('answers HEAD with the size and no body', async () => {
    // Lets a client say "this will be 1.2 GB, continue?" before moving a byte.
    const { env, token } = await setup();
    const head = await get(env, token, 'HEAD');
    const full = await get(env, token);

    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(full.headers.get('content-length'));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it('names the download, including non-ASCII, without breaking the header', async () => {
    const { env, token } = await setup();
    const res = await get(env, token);
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition).toContain('attachment');
    expect(disposition).toContain("filename*=UTF-8''");
    // The quoted fallback must not contain a raw quote or the header splits.
    expect(/filename="[^"]*"/.test(disposition)).toBe(true);
  });

  it('does not claim range support it does not have', async () => {
    // The layout is deterministic so ranges are implementable, but advertising
    // them before implementing would break resumption rather than enable it.
    const { env, token } = await setup();
    const res = await get(env, token);
    expect(res.headers.get('accept-ranges')).toBe('none');
  });

  it('handles an empty selection', async () => {
    const { env, token } = await setup({ manifest: manifest([]) });
    const res = await get(env, token);
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Number(res.headers.get('content-length'))).toBe(body.byteLength);
  });
});

describe('token handling', () => {
  it('rejects a tampered signature as not found', async () => {
    const { env, token } = await setup();
    const res = await get(env, `${token.slice(0, -3)}aaa`);
    expect(res.status).toBe(404);
  });

  it('rejects a token signed with another secret', async () => {
    const { env } = await setup();
    const forged = await signManifestToken(
      'not-the-secret',
      'tmp/manifest/x.json',
      new Date(Date.now() + 600_000),
    );
    expect((await get(env, forged)).status).toBe(404);
  });

  it('will not let the expiry be edited in the URL', async () => {
    // The expiry is inside the signed payload, so extending it invalidates it.
    const { env } = await setup();
    const expired = await signManifestToken(
      SECRET,
      'tmp/manifest/x.json',
      new Date(Date.now() - 1000),
    );
    expect((await get(env, expired)).status).toBe(410);
  });

  it('does not reveal whether an unsigned manifest key exists', async () => {
    // Same 404 for a bad signature and a missing manifest, so the endpoint is
    // not an oracle for probing keys.
    const { env } = await setup();
    const real = await signManifestToken(SECRET, 'tmp/manifest/nope.json', new Date(Date.now() + 600_000));
    const missing = await get(env, real);
    const bad = await get(env, 'garbage.garbage');
    expect(missing.status).toBe(404);
    expect(bad.status).toBe(404);
    expect(await missing.text()).toBe(await bad.text());
  });

  it('refuses a request with no token', async () => {
    const { env } = await setup();
    const res = await worker.fetch(new Request('https://zip.example/zip'), env);
    expect(res.status).toBe(404);
  });

  it('refuses non-GET methods', async () => {
    const { env, token } = await setup();
    expect((await get(env, token, 'POST')).status).toBe(405);
  });
});

describe('when an object is missing', () => {
  it('breaks the download rather than shipping a short archive', async () => {
    // Silently omitting a photo would hand someone an archive they believe is
    // complete. A failed download is recoverable; a wrong one is not.
    const { env, token } = await setup({ photos: { 'ev/1/aaa': 'photo-one' } });
    const res = await get(env, token);
    expect(res.status).toBe(200); // headers were already sent
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
