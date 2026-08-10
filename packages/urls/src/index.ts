/**
 * Signed image URLs — docs/design.md §11.
 *
 * A grid asks for 200 thumbnails, so how these URLs are built decides whether
 * the CDN does any work at all. Three options, two of them bad:
 *
 *   - Presign each object per request. Cheap to generate, but every URL is
 *     unique, so the edge cache never hits and every thumbnail is an origin
 *     read forever.
 *   - Have the Worker check a credential cookie. Correct, but a response that
 *     varies by cookie is effectively uncacheable at the edge.
 *   - Sign a stable path with a *coarse* expiry. Every viewer of the same
 *     event within the same hour generates a byte-identical URL, so the edge
 *     cache works, and the URL stops working within the hour.
 *
 * The third is what this implements. The rounding is the whole trick: an
 * expiry of "now + 1 hour" would differ per request and defeat the cache, so
 * the expiry is snapped up to the next hour boundary and every viewer in that
 * window agrees on it.
 *
 * Web Crypto only, so the same code signs in Next and verifies in a Worker.
 */

export {
  AVIF_KINDS,
  allDerivativeKeysFor,
  IMAGE_FORMATS,
  IMAGE_KINDS,
  MIME,
  derivativeKey,
  derivativeKeyFrom,
  epochMarkerKey,
  extensionOf,
  formatFromExtension,
  formatOf,
  formatsFor,
  objectKeyFor,
  type ImageFormat,
  type ImageKind,
  type ImageRef,
} from './keys';

import {
  IMAGE_KINDS,
  extensionOf,
  formatFromExtension,
  formatOf,
  formatsFor,
  type ImageFormat,
  type ImageKind,
  type ImageRef,
} from './keys';

export const HOUR_SECONDS = 3600;

/** Hex sha256, as stored in `photo.content_hash`. */
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const encoder = new TextEncoder();

/**
 * The next hour boundary at or after `now + minTtlSeconds`.
 *
 * Snapping *up* rather than to the nearest boundary guarantees the URL is
 * valid for at least the requested lifetime — rounding down would hand out
 * URLs that expire in seconds at :59 past the hour.
 */
export function hourBucket(now: Date, minTtlSeconds = HOUR_SECONDS): number {
  const target = Math.floor(now.getTime() / 1000) + minTtlSeconds;
  return Math.ceil(target / HOUR_SECONDS) * HOUR_SECONDS;
}

// Return type inferred rather than annotated `Promise<CryptoKey>`: this
// package is compiled under both DOM and Node type roots, which each declare
// `CryptoKey`, and naming it makes the build depend on which one wins.
async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64url(bytes: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += String.fromCharCode(b);
  return btoa(out).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function signature(
  secret: string,
  ref: ImageRef,
  expires: number,
): Promise<string> {
  // The format is signed like everything else in the path. Leaving it out
  // would let anyone holding a valid thumb URL edit the extension and pull
  // whichever encoding they liked — harmless today, and exactly the kind of
  // "the signature covers most of the URL" that stops being harmless later.
  const payload =
    `${ref.eventId}:${ref.hash}:${ref.kind}:${formatOf(ref)}:` +
    `${ref.capEpoch}:${expires}`;
  return base64url(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)),
  );
}

/**
 * `/img/<eventId>/<hash>/<kind>.<ext>?v=<epoch>&e=<expiry>&s=<sig>`
 *
 * The path carries everything needed to derive the object key, so the Worker
 * needs no database. The content hash is not a secret — it grants nothing
 * without the signature — and putting it in the path is what makes the URL
 * stable and therefore cacheable.
 *
 * The extension is part of that path, so the AVIF and the JPEG of the same
 * thumbnail are two URLs and two cache entries. No `Vary`, and no way for one
 * to be served in place of the other.
 */
export async function signImagePath(
  secret: string,
  ref: ImageRef,
  now: Date = new Date(),
  minTtlSeconds = HOUR_SECONDS,
): Promise<string> {
  const expires = hourBucket(now, minTtlSeconds);
  const sig = await signature(secret, ref, expires);
  return (
    `/img/${ref.eventId}/${ref.hash}/${ref.kind}.${extensionOf(ref)}` +
    `?v=${ref.capEpoch}&e=${expires}&s=${sig}`
  );
}

export type VerifyResult =
  | { ok: true; ref: ImageRef; expires: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/** Verifies a request URL and returns what it refers to. */
export async function verifyImageRequest(
  secret: string,
  url: URL,
  now: Date = new Date(),
): Promise<VerifyResult> {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'img') return { ok: false, reason: 'malformed' };

  const [, eventId, hash, leaf] = parts as [string, string, string, string];
  if (!UUID_RE.test(eventId) || !HASH_RE.test(hash)) {
    return { ok: false, reason: 'malformed' };
  }

  const dot = leaf.lastIndexOf('.');
  // The extension is required. An older unsuffixed URL is not accepted with a
  // default, because it would verify against a signature computed over a
  // format the caller never named — better to let those expire than to guess.
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const kind = leaf.slice(0, dot);
  const ext = leaf.slice(dot + 1);

  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: 'malformed' };
  }
  const format = formatFromExtension(ext);
  // Only the encodings that exist for this size. Asking for `full.avif`
  // resolves to an object nobody wrote, so it is malformed rather than a 404.
  if (!format || !formatsFor(kind as ImageKind).includes(format)) {
    return { ok: false, reason: 'malformed' };
  }

  const capEpoch = Number(url.searchParams.get('v'));
  const expires = Number(url.searchParams.get('e'));
  const provided = url.searchParams.get('s');
  if (!Number.isInteger(capEpoch) || !Number.isInteger(expires) || !provided) {
    return { ok: false, reason: 'malformed' };
  }

  const ref: ImageRef = { eventId, hash, kind: kind as ImageKind, format, capEpoch };
  const expected = await signature(secret, ref, expires);

  if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: 'bad_signature' };

  // Checked after the signature, so an unsigned URL never reveals whether the
  // object it named exists.
  if (expires * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, ref, expires };
}

