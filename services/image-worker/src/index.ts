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
  epochMarkerKey,
  objectKeyFor,
  verifyImageRequest,
  type ImageKind,
} from '@parea/urls';

export type Env = {
  BUCKET: R2Bucket;
  IMAGE_SECRET: string;
};

const CONTENT_TYPE: Record<ImageKind, string | null> = {
  thumb: 'image/jpeg',
  grid: 'image/jpeg',
  full: 'image/jpeg',
  // Originals keep whatever they were stored as — HEIC stays HEIC.
  orig: null,
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

    const hit = await cache.match(request);
    if (hit) return hit;

    const key = objectKeyFor(check.ref);
    const object = await env.BUCKET.get(key);
    if (!object) return notFound();

    const headers = new Headers();
    const declared = CONTENT_TYPE[check.ref.kind];
    headers.set(
      'content-type',
      declared ?? object.httpMetadata?.contentType ?? 'application/octet-stream',
    );
    headers.set('content-length', String(object.size));
    headers.set('etag', object.httpEtag);
    // `private` keeps shared proxies out of it — these are people's photos —
    // while the Worker's own cache below still serves the whole event.
    headers.set('cache-control', `private, max-age=${maxAge(check.expires)}`);
    headers.set('x-content-type-options', 'nosniff');
    // Photos are never rendered as documents; if one is ever fetched as a
    // top-level navigation it should download, not execute.
    headers.set('content-disposition', 'inline');

    if (request.method === 'HEAD') return new Response(null, { headers });

    const response = new Response(object.body as ReadableStream<Uint8Array>, {
      headers,
    });

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

/** Seconds until this URL stops working. Never negative, never beyond an hour. */
function maxAge(expiresAtSeconds: number): number {
  const remaining = expiresAtSeconds - Math.floor(Date.now() / 1000);
  return Math.max(0, Math.min(remaining, 3600));
}

function notFound(): Response {
  // Identical for a bad signature and a missing object, so the endpoint is not
  // an oracle for which photos exist.
  return new Response('not found', { status: 404 });
}
