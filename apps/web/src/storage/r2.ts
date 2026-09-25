/**
 * Cloudflare R2 over the S3 API.
 *
 * Chosen for zero egress (design §2). Presigned URLs mean the browser talks to
 * R2 directly in both directions, so photo bytes never reach this process.
 *
 * Reads are presigned per-request here, which is the acknowledged
 * worse-but-working option from design §11: every URL is unique, so the CDN
 * cache never hits. The fix is the `/img/*` Worker with hour-bucketed
 * signatures, so viewers of the same event generate identical URLs. Until that
 * exists this is correct and uncached.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ObjectHead, PresignedUpload, Storage } from './index';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export class R2Storage implements Storage {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async presignPut(
    key: string,
    contentType: string,
    byteSize: number,
    ttlSeconds = 900,
  ): Promise<PresignedUpload> {
    /*
     * `ContentLength` is signed, and that is what makes the quota true.
     *
     * The signature covered bucket, key and content type — nothing about size.
     * So the number a client declared at presign, which is what its quota was
     * charged against, had no bearing on what it could then upload: fifty
     * files claiming one byte each bought fifty slots that would each take
     * gigabytes. The real size was written later by `/complete`, which an
     * abusive client simply never calls.
     *
     * Setting it puts `content-length` in `X-Amz-SignedHeaders`, so a body of
     * any other size fails the signature at R2 rather than at us. Verified
     * against the live bucket: the declared size uploads, forty times it
     * answers 403.
     *
     * Browsers and React Native both set `Content-Length` themselves from the
     * body and forbid scripts overriding it, so no client has to do anything
     * differently — which is why this is not in the returned `headers`.
     */
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: byteSize,
      }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async presignGet(key: string, ttlSeconds = 3600): Promise<string> {
    // GetObjectCommand is used to *sign* a URL, never executed here — the
    // command object is not sent, only turned into a signature. The egress
    // invariant test knows about this one call site.
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  async putSmall(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        size: out.ContentLength ?? 0,
        etag: (out.ETag ?? '').replaceAll('"', ''),
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
