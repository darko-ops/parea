/**
 * Object storage — docs/design.md §2.
 *
 * THE INTERFACE HAS NO METHOD THAT RETURNS BYTES, AND THAT IS DELIBERATE.
 *
 * The core architectural invariant is that no photo byte passes through the
 * Next.js origin: bytes move browser ↔ R2 directly, or browser ↔ Worker ↔ R2.
 * The failure mode is a one-line mistake — `return new Response((await
 * r2.get(key)).body)` in a route handler — which routes ~20GB per event through
 * metered bandwidth, is invisible until the bill, and is unrecoverable after
 * the fact.
 *
 * Rather than rely on remembering that, the app tier is handed a client that
 * *cannot* read an object body. It can grant a URL for someone else to read it.
 * A test (test/egress-invariant.test.ts) checks nobody has reached around this.
 */

export type PresignedUpload = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
};

export type ObjectHead = {
  size: number;
  etag: string;
};

export interface Storage {
  /** A URL the client PUTs the file to. Bytes go client → storage, never via us. */
  presignPut(
    key: string,
    contentType: string,
    ttlSeconds?: number,
  ): Promise<PresignedUpload>;

  /** A URL the client GETs the file from. Same rule, other direction. */
  presignGet(key: string, ttlSeconds?: number): Promise<string>;

  /** Metadata only — size and etag. Never a body. */
  head(key: string): Promise<ObjectHead | null>;

  delete(key: string): Promise<void>;
}

/** `ev/<eventId>/<discriminator>` — content-addressed once the deriver runs. */
export function objectKey(eventId: string, discriminator: string): string {
  return `ev/${eventId}/${discriminator}`;
}

export { getStorage } from './factory';
