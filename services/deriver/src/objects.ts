/**
 * Object access for the deriver.
 *
 * This tier IS allowed to read bytes — it is the component whose entire job is
 * reading them. The egress invariant in design §2 is about the Next.js origin,
 * and R2 reads are free from anywhere, so a container pulling originals costs
 * nothing. The web app's Storage interface deliberately cannot do this; this
 * one deliberately can.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

export interface ObjectStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class R2ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    config: { accountId: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/** Reads the same `.storage` directory the web app writes to in development. */
export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      return null;
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    const root = resolve(this.root);
    const path = resolve(join(root, normalize(key)));
    if (path !== root && !path.startsWith(root + '/')) {
      throw new Error('key escapes storage root');
    }
    return path;
  }
}

export function objectStoreFromEnv(): ObjectStore {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return new R2ObjectStore(bucket, { accountId, accessKeyId, secretAccessKey });
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('R2 is not configured; refusing to run against local disk.');
  }
  return new LocalObjectStore(process.env.LOCAL_STORAGE_DIR ?? '.storage');
}
