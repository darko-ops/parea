/**
 * Download manifests — docs/design.md §10.
 *
 * The Worker that streams an archive has no database. Rather than give it one,
 * the app tier does the authorization, resolves exactly which objects belong in
 * the archive, and hands the Worker a signed, short-lived list. The Worker's
 * whole job becomes: check the signature, read those keys, write a zip.
 *
 * That keeps the authorization decision in the one place that makes it
 * (@parea/core's authorize), and keeps the data plane free of credentials it
 * would otherwise need.
 *
 * A manifest is too large for a URL — 250 photos is ~20KB — so it is written to
 * object storage and the token carries only its key plus a signature. Web
 * Crypto throughout, so this runs unchanged in a Worker and in Node.
 */

export const MANIFEST_VERSION = 1;

export type ManifestEntry = {
  key: string;
  name: string;
  size: number;
  crc32: number;
  /** ISO 8601. Becomes the archive member's timestamp. */
  takenAt: string;
};

export type DownloadManifest = {
  version: number;
  eventId: string;
  /** Used for the download filename; already sanitised by the minting side. */
  archiveName: string;
  createdAt: string;
  entries: ManifestEntry[];
};

const encoder = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function base64url(bytes: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += String.fromCharCode(b);
  return btoa(out).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * A token binding a manifest key to an expiry.
 *
 * The expiry is inside the signed payload rather than alongside it, so it
 * cannot be extended by editing the URL.
 */
export async function signManifestToken(
  secret: string,
  manifestKey: string,
  expiresAt: Date,
): Promise<string> {
  const payload = `${manifestKey}:${Math.floor(expiresAt.getTime() / 1000)}`;
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload));
  return `${btoa(payload).replaceAll('=', '')}.${base64url(mac)}`;
}

export type TokenCheck =
  | { ok: true; manifestKey: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function verifyManifestToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<TokenCheck> {
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return { ok: false, reason: 'malformed' };

  let payload: string;
  try {
    payload = atob(token.slice(0, cut));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const expected = await crypto.subtle
    .sign('HMAC', await key(secret), encoder.encode(payload))
    .then(base64url);

  // Constant-time-ish: compare full strings of equal length rather than
  // short-circuiting on the first differing character.
  const provided = token.slice(cut + 1);
  if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: 'bad_signature' };

  const split = payload.lastIndexOf(':');
  const manifestKey = payload.slice(0, split);
  const expiresAt = Number(payload.slice(split + 1));
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
  // Checked after the signature, so an invalid token never reveals whether the
  // key it named was real.
  if (expiresAt * 1000 < now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, manifestKey };
}

export function parseManifest(text: string): DownloadManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Partial<DownloadManifest>;
  if (m.version !== MANIFEST_VERSION) return null;
  if (typeof m.eventId !== 'string' || !Array.isArray(m.entries)) return null;

  for (const entry of m.entries) {
    if (typeof entry?.key !== 'string' || typeof entry?.name !== 'string') return null;
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) return null;
    if (!Number.isFinite(entry.crc32)) return null;
  }
  return m as DownloadManifest;
}

/** RFC 5987 filename, plus a plain-ASCII fallback for older clients. */
export function contentDisposition(archiveName: string): string {
  const ascii = archiveName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`;
}
