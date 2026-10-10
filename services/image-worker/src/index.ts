/**
 * Image serving — docs/design.md §11.
 *
 * Verifies a signed path and streams the object from R2. Two reasons this is a
 * Worker rather than a Next.js route: R2 reads are free from inside
 * Cloudflare, and the URLs are stable enough to cache at the edge, so a
 * popular event's thumbnails are served without touching R2 at all after the
 * first request.
 *
 * Holds no database credentials and makes no access decision. Possession of a
 * validly signed URL is the authorization, and those are only minted by the
 * app tier after `authorize(view)` has passed.
 *
 * ── On rotation ──────────────────────────────────────────────────────────
 * Rotating an event's link must stop old image URLs working, and the signed
 * `cap_epoch` alone cannot do that: an old URL is internally consistent and
 * verifies fine against its own epoch. So the app writes an epoch marker to
 * storage on rotate, and every request here compares the URL's epoch against
 * it and rejects anything older.
 *
 * The marker read is cached at the edge, so it costs at most one small read
 * per event per EPOCH_TTL_SECONDS per colo rather than one per image. That
 * caching is also the limit of the guarantee: revocation takes effect within
 * that window, not instantly. A minute is a deliberate trade against making
 * every thumbnail request pay for a storage round trip.
 *
 * Absent marker means never rotated, i.e. epoch 1, so events created before
 * rotation existed need no backfill.
 */

import {
  MIME,
  epochMarkerKey,
  formatOf,
  objectKeyFor,
  revokedMarkerKey,
  verifyImageRequest,
} from '@parea/urls';

export type Env = {
  BUCKET: R2Bucket;
  IMAGE_SECRET: string;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const cache = caches.default;

    // Verification happens before the cache lookup, not after. It is only an
    // HMAC, and doing it first is what lets rotation revoke access to
    // *already cached* responses — checking the cache first would serve them
    // straight back out.
    const check = await verifyImageRequest(env.IMAGE_SECRET, url);
    if (!check.ok) {
      return check.reason === 'expired'
        ? new Response('expired', { status: 410 })
        : notFound();
    }

    const currentEpoch = await currentEpochFor(check.ref.eventId, env, ctx);
    if (check.ref.capEpoch < currentEpoch) {
      // The link was rotated after this URL was minted.
      return new Response('revoked', { status: 410 });
    }

    /*
     * And this one photograph, which may have been taken down since the URL
     * was signed. Checked before the cache, or a copy cached an hour ago would
     * go on being served. Answered as not found — the same as a photo that
     * never existed — so a URL is not a way to learn one was removed.
     */
    if (await isRevoked(check.ref.eventId, check.ref.hash, env, ctx)) return notFound();

    const hit = await cache.match(request);
    if (hit) return hit;

    const key = objectKeyFor(check.ref);
    let object = await env.BUCKET.get(key);

    /*
     * An AVIF not made yet: answer with the JPEG.
     *
     * The deriver makes a photo's JPEG sizes first so it appears sooner, and
     * its AVIF versions afterwards, when idle. In between, a browser that
     * prefers AVIF asks for one that is not there — and a `<picture>` does not
     * fall back on a 404, it shows a broken image. So the JPEG is served in its
     * place, labelled as what it is, and kept out of the cache so the real AVIF
     * takes over as soon as it exists.
     */
    let standIn = false;
    if (!object && check.ref.kind !== 'orig' && formatOf(check.ref) === 'avif') {
      object = await env.BUCKET.get(objectKeyFor({ ...check.ref, format: 'jpeg' }));
      standIn = object !== null;
    }
    if (!object) return notFound();

    const headers = new Headers();
    // Derivatives are declared from the signed path rather than from what R2
    // reports, so a mislabelled object cannot make the Worker claim an AVIF is
    // a JPEG. Originals keep whatever they were stored as — HEIC stays HEIC.
    const declared =
      check.ref.kind === 'orig' ? null : standIn ? MIME.jpeg : MIME[formatOf(check.ref)];
    headers.set(
      'content-type',
      declared ?? object.httpMetadata?.contentType ?? 'application/octet-stream',
    );
    headers.set('content-length', String(object.size));
    headers.set('etag', object.httpEtag);
    // `private` keeps shared proxies out of it — these are people's photos —
    // while the Worker's own cache below still serves the whole event.
    // A stand-in is only good until its AVIF is made, so the browser is told
    // to ask again soon.
    headers.set(
      'cache-control',
      standIn ? 'private, max-age=60' : `private, max-age=${maxAge(check.expires)}`,
    );
    headers.set('x-content-type-options', 'nosniff');
    /*
     * Shown, unless the URL asks to be saved. A Download button is an
     * `<a download>`, and browsers ignore `download` on a link to another host
     * — this one, from www — so it opened the photo in a new page instead.
     * `?download=1` asks for an attachment with a filename. It is not part of
     * the signature (`v`, `e`, `s` and the path are), and grants nothing a
     * plain view of the same URL does not.
     */
    headers.set('content-disposition', url.searchParams.get('download') === '1' ? attachment(check.ref, headers.get('content-type')!) : 'inline');

    if (request.method === 'HEAD') return new Response(null, { headers });

    const response = new Response(object.body as ReadableStream<Uint8Array>, {
      headers,
    });

    if (standIn) return response;

    // The URL dies at the same moment for every viewer, so the cache entry can
    // live exactly that long and never serve something whose URL has expired.
    const cacheable = response.clone();
    cacheable.headers.set('cache-control', `public, max-age=${maxAge(check.expires)}`);
    ctx.waitUntil(cache.put(request, cacheable));

    return response;
  },
};

const EPOCH_TTL_SECONDS = 60;

/**
 * The event's current cap_epoch, edge-cached.
 *
 * Cached under a synthetic URL rather than the real request, so one lookup
 * serves every photo in the event. Failing open on a storage error would mean
 * a blip re-enables revoked URLs, and failing closed would mean a blip breaks
 * every grid — the former is a security regression, so this treats an error as
 * "unknown" and falls back to the strictest thing it can know without state:
 * the marker's absence, which is epoch 1.
 */
async function currentEpochFor(
  eventId: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<number> {
  const cacheKey = new Request(`https://epoch.internal/${eventId}`);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return Number(await cached.text()) || 1;

  const object = await env.BUCKET.get(epochMarkerKey(eventId));
  const epoch = object ? Number(await object.text()) || 1 : 1;

  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(String(epoch), {
        headers: { 'cache-control': `public, max-age=${EPOCH_TTL_SECONDS}` },
      }),
    ),
  );
  return epoch;
}

/**
 * Whether a photograph's links have been revoked, cached for as long as the
 * epoch is — so a removal reaches every edge within a minute, at the cost of
 * one small read per photo per minute per location.
 */
async function isRevoked(
  eventId: string,
  hash: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<boolean> {
  const cacheKey = new Request(`https://revoked.internal/${eventId}/${hash}`);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return (await cached.text()) === '1';

  const revoked = (await env.BUCKET.head(revokedMarkerKey(eventId, hash))) !== null;
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(revoked ? '1' : '0', {
        headers: { 'cache-control': `public, max-age=${EPOCH_TTL_SECONDS}` },
      }),
    ),
  );
  return revoked;
}

/** Seconds until this URL stops working. Never negative, never beyond an hour. */
function maxAge(expiresAtSeconds: number): number {
  const remaining = expiresAtSeconds - Math.floor(Date.now() / 1000);
  return Math.max(0, Math.min(remaining, 3600));
}

/** `attachment` with a filename from the photo's hash and what is being served. */
function attachment(ref: { hash: string }, contentType: string): string {
  const ext: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  };
  return `attachment; filename="parea-${ref.hash.slice(0, 12)}.${ext[contentType] ?? 'bin'}"`;
}

function notFound(): Response {
  // Identical for a bad signature and a missing object, so the endpoint is not
  // an oracle for which photos exist.
  return new Response('not found', { status: 404 });
}
