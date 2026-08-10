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
 * The design says rotating an event's link invalidates outstanding image URLs
 * because `cap_epoch` is in the signature. That is only half true here, and
 * knowingly so. The epoch is signed and carried in the URL, but this Worker
 * has no way to learn the event's *current* epoch without per-event state, so
 * a URL minted before a rotation stays valid until it expires — at most one
 * hour, bounded by the hour bucket.
 *
 * That is the actual guarantee today: rotation revokes reads within the hour,
 * not instantly. Closing the gap needs the app to write a small
 * `ev/<id>/.epoch` marker on rotate and this Worker to read it (cached at the
 * edge for a minute or so) and reject anything older. Deliberately not built
 * yet, because the rotate endpoint itself does not exist — it would be
 * write-only code guarding a feature nobody can trigger.
 */

import {
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

    // Served from the edge before any verification work, because the signature
    // is part of the cache key — a cached hit is by definition a URL that
    // already verified.
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    const check = await verifyImageRequest(env.IMAGE_SECRET, url);
    if (!check.ok) {
      return check.reason === 'expired'
        ? new Response('expired', { status: 410 })
        : notFound();
    }

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
