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
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

export interface ObjectStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Can this store actually be used, right now, with the credentials it has?
   *
   * Added after a deployment set both R2 secrets to a three-byte ellipsis —
   * pasted out of an example — and every check in the system reported success.
   * `flyctl` said the update succeeded, Fly said the machine was healthy, and
   * the boot probe said "Ready to ingest", because it verified codecs,
   * exiftool, AVIF and the scanner and never once touched storage. The first
   * thing that would have noticed was a photograph failing to appear, with the
   * row left `pending` and nobody told.
   *
   * So it is checked at boot, where "this container cannot do the job" is
   * something the container can say about itself.
   */
  reachable(): Promise<{ ok: boolean; detail: string }>;
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

  /**
   * A HEAD for a key that does not exist, and the status code is the answer.
   *
   * 404 means the request was signed, accepted and the bucket searched — which
   * is everything this needs to know. 401 or 403 means the credentials are
   * wrong, and a malformed one does not even reach the network: the SDK
   * refuses to sign a non-ASCII secret and throws locally, which is exactly
   * what the ellipsis produced.
   *
   * `HeadObject` rather than `HeadBucket`, deliberately. Both discriminate —
   * measured against the live bucket, good credentials answer 404 and 200
   * respectively, bad ones answer 401 to either — but `HeadBucket` is a
   * bucket-level operation and this service is meant to hold an object-scoped
   * token. A readiness check that only passes for an over-privileged token
   * would quietly punish doing the right thing.
   *
   * The key is random so that nothing can make this pass by creating it.
   */
  async reachable(): Promise<{ ok: boolean; detail: string }> {
    const key = `.probe/${crypto.randomUUID()}`;
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      // Improbable — the key is a fresh UUID — but a 200 still proves the
      // round trip worked, which is what is being asked.
      return { ok: true, detail: `${this.bucket} reachable` };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return { ok: true, detail: `${this.bucket} reachable` };

      /*
       * The status is the only thing worth reading here.
       *
       * The SDK collapses every R2 rejection into `name: 'Unknown'` and
       * `message: 'UnknownError'`, so the first version of this printed
       * `FAILED — UnknownError` and left whoever was reading it no better off
       * than a blank line. That is not hypothetical: it is what the log said
       * when both credentials were set to a placeholder, in the very incident
       * this check exists to catch.
       *
       * 400 is the one that was missed. A credential R2 cannot parse at all —
       * a placeholder, a truncated paste, a value with a space in it — is a
       * malformed `Authorization` header and comes back 400, not 401. Both
       * mean the same thing to whoever has to fix it, so they say the same
       * thing and differ only in the hint.
       */
      if (status === 400 || status === 401 || status === 403) {
        const hint =
          status === 400
            ? 'the value looks malformed — a placeholder, or a truncated paste'
            : 'the credentials were rejected';
        return {
          ok: false,
          detail:
            `FAILED — R2 refused the request (HTTP ${status}): ${hint}. ` +
            'Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.',
        };
      }

      /*
       * Anything else, with the status kept even though it is unrecognised.
       * `UnknownError` alone is what sent somebody to read this file rather
       * than fix their deployment, and a number is the difference between "it
       * broke" and "it broke the way a wrong region breaks".
       */
      const name = (err as { name?: string })?.name;
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
      const said = message && message !== 'UnknownError' ? message : (name ?? 'no detail');
      return {
        ok: false,
        detail: `FAILED — ${said}${status ? ` (HTTP ${status})` : ' (no response)'}`,
      };
    }
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

  /** Writable, which is the same question one directory down. */
  async reachable(): Promise<{ ok: boolean; detail: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      const probe = this.resolveKey(`.probe/${crypto.randomUUID()}`);
      await mkdir(dirname(probe), { recursive: true });
      await writeFile(probe, Buffer.alloc(0));
      await rm(probe, { force: true });
      return { ok: true, detail: `${resolve(this.root)} writable` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `FAILED — ${message}` };
    }
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
