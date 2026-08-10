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

export const IMAGE_KINDS = ['thumb', 'grid', 'full', 'orig'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

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

async function hmacKey(secret: string): Promise<CryptoKey> {
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

export type ImageRef = {
  eventId: string;
  /** Hex content hash. The object key is derived from it, not carried. */
  hash: string;
  kind: ImageKind;
  /** The event's cap_epoch at mint time — see the note on rotation below. */
  capEpoch: number;
};

async function signature(
  secret: string,
  ref: ImageRef,
  expires: number,
): Promise<string> {
  const payload = `${ref.eventId}:${ref.hash}:${ref.kind}:${ref.capEpoch}:${expires}`;
  return base64url(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)),
  );
}

/**
 * `/img/<eventId>/<hash>/<kind>?v=<epoch>&e=<expiry>&s=<sig>`
 *
 * The path carries everything needed to derive the object key, so the Worker
 * needs no database. The content hash is not a secret — it grants nothing
 * without the signature — and putting it in the path is what makes the URL
 * stable and therefore cacheable.
 */
export async function signImagePath(
  secret: string,
  ref: ImageRef,
  now: Date = new Date(),
  minTtlSeconds = HOUR_SECONDS,
): Promise<string> {
  const expires = hourBucket(now, minTtlSeconds);
  const sig = await signature(secret, ref, expires);
  return `/img/${ref.eventId}/${ref.hash}/${ref.kind}?v=${ref.capEpoch}&e=${expires}&s=${sig}`;
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

  const [, eventId, hash, kind] = parts as [string, string, string, string];
  if (!UUID_RE.test(eventId) || !HASH_RE.test(hash)) {
    return { ok: false, reason: 'malformed' };
  }
  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: 'malformed' };
  }

  const capEpoch = Number(url.searchParams.get('v'));
  const expires = Number(url.searchParams.get('e'));
  const provided = url.searchParams.get('s');
  if (!Number.isInteger(capEpoch) || !Number.isInteger(expires) || !provided) {
    return { ok: false, reason: 'malformed' };
  }

  const ref: ImageRef = { eventId, hash, kind: kind as ImageKind, capEpoch };
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

/**
 * Where an event's current cap_epoch is recorded.
 *
 * The image Worker has no database, so rotation has to leave a trace it can
 * read. A dotted name cannot collide with a photo key, since those are always
 * a 64-character hex hash.
 *
 * Absent means "never rotated", i.e. epoch 1 — which is correct for every
 * event created before rotation existed, so no backfill is needed.
 */
export function epochMarkerKey(eventId: string): string {
  return `ev/${eventId}/.epoch`;
}

/**
 * Object key for a reference. Must match what the deriver writes.
 *
 * Derivatives are siblings of the original (`<key>.thumb.jpg`) rather than
 * children (`<key>/thumb.jpg`), because the latter makes the original's key a
 * directory prefix as well as an object — fine on S3, impossible on a
 * filesystem.
 */
export function objectKeyFor(ref: ImageRef): string {
  const base = `ev/${ref.eventId}/${ref.hash}`;
  return ref.kind === 'orig' ? base : `${base}.${ref.kind}.jpg`;
}
