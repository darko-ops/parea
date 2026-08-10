/**
 * Filesystem storage for local development.
 *
 * DEVELOPMENT ONLY. Its presigned URLs point back at `/api/dev/blob`, which is
 * the single place in the app where photo bytes legitimately pass through the
 * Next.js process — and it refuses to load when NODE_ENV is production, so the
 * arrangement cannot survive a deploy by accident.
 *
 * The point of having it: `npm run dev` works with no Cloudflare account, so
 * the upload path can be built and tested before any infrastructure exists.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, resolve } from 'node:path';

import type { ObjectHead, PresignedUpload, Storage } from './index';

export class LocalStorage implements Storage {
  constructor(
    private readonly root: string,
    private readonly secret: string,
    private readonly baseUrl: string,
  ) {}

  private signedUrl(key: string, verb: 'put' | 'get', ttlSeconds: number): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = signBlob(this.secret, key, verb, expires);
    const q = new URLSearchParams({ key, verb, exp: String(expires), sig });
    return `${this.baseUrl}/api/dev/blob?${q}`;
  }

  async presignPut(
    key: string,
    contentType: string,
    ttlSeconds = 900,
  ): Promise<PresignedUpload> {
    return {
      url: this.signedUrl(key, 'put', ttlSeconds),
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async presignGet(key: string, ttlSeconds = 3600): Promise<string> {
    return this.signedUrl(key, 'get', ttlSeconds);
  }

  async head(key: string): Promise<ObjectHead | null> {
    const path = this.resolveKey(key);
    try {
      const info = await stat(path);
      const bytes = await readFile(path);
      return {
        size: info.size,
        etag: createHash('md5').update(bytes).digest('hex'),
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  // --- used only by the dev blob route ---

  async writeBytes(key: string, bytes: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async readBytes(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      return null;
    }
  }

  verify(key: string, verb: string, expires: number, sig: string): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const expected = signBlob(this.secret, key, verb, expires);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Refuses to escape the storage root, however creative the key. */
  private resolveKey(key: string): string {
    const root = resolve(this.root);
    const path = resolve(join(root, normalize(key)));
    if (path !== root && !path.startsWith(root + '/')) {
      throw new Error('key escapes storage root');
    }
    return path;
  }
}

function signBlob(
  secret: string,
  key: string,
  verb: string,
  expires: number,
): string {
  return createHmac('sha256', secret)
    .update(`${verb}:${key}:${expires}`)
    .digest('base64url');
}
