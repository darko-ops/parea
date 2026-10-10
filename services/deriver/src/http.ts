/**
 * The HTTP surface QStash delivers to.
 *
 * Deliberately small: read the body, prove it came from QStash, hand the photo
 * id to `createHandler`, and answer with whatever it decides. Everything about
 * *what* happens to a photo lives in `serve.ts` and `pipeline.ts`; this file is
 * only the door.
 *
 * ## Why the raw body, and why it is read before anything else
 *
 * The signature covers a SHA-256 of the exact bytes sent. Parsing the JSON and
 * re-serialising it changes those bytes — key order, whitespace, number
 * formatting — so the body has to be verified in the form it arrived and
 * parsed only afterwards. A verifier fed a re-serialised body fails on honest
 * requests and teaches whoever is debugging it to turn verification off.
 *
 * ## Why the URL is configured rather than inferred
 *
 * QStash signs the destination URL into the token's `sub` claim, so
 * verification has to compare against the same string QStash was given. Behind
 * Fly's proxy the request arrives as plain HTTP with a rewritten host, so
 * rebuilding the URL from the request would produce something that never
 * matches. `DERIVER_PUBLIC_URL` is the URL as the sender knows it.
 *
 * ## Why an unverified request is 401 and not 404
 *
 * There is nothing to hide here. The endpoint's existence is not a secret —
 * the signature is what protects it — and answering 404 to a real QStash
 * delivery whose keys have drifted would send it to the dead letter queue
 * looking like a routing mistake rather than an authentication one.
 */

import type { ScanVerdict } from '@parea/core';
import { Receiver } from '@upstash/qstash';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { ScanUnavailable } from './safety';

import type { Reply } from './serve';

/** Where a delivery is expected. Anything else is a 404. */
export const JOB_PATH = '/jobs/photo';
/**
 * Where the web app has its own images checked — moments, group photos,
 * profile pictures, covers — so that they too are hashed here and only the
 * hash goes to Microsoft. The web app runs on Vercel, which builds from git and
 * so cannot carry the Edge Hash library; this machine has it. See
 * `apps/web/src/deriverScanner.ts`.
 */
export const SCAN_PATH = '/scan';
/** A scan copy is at most PhotoDNA's 4 MB; a little over, and no more. */
const SCAN_BODY_LIMIT = 5 * 1024 * 1024;

/**
 * Proves a request came from QStash, or explains why not.
 *
 * Two keys because QStash rotates them: the current one signs, the next one is
 * published ahead of the change so a deployment that has not restarted still
 * verifies. `Receiver` tries both, which is the whole reason to use it rather
 * than check one.
 *
 * Null when the keys are absent, and the caller decides what that means — see
 * `createJobServer`, which refuses to start rather than listening without it.
 */
export function receiverFromEnv(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  return new Receiver({ currentSigningKey, nextSigningKey });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      /*
       * A delivery is a photo id and nothing else. Refusing early means a
       * body that is not one cannot become memory pressure on a machine whose
       * whole job is to have headroom for an image.
       */
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * The body, up to `limit`. Past it, stops keeping what arrives and rejects —
 * without cutting the connection, so the 413 is actually heard.
 */
function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** The bearer token, compared in constant time. */
function bearerIs(request: IncomingMessage, token: string): boolean {
  const auth = request.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const a = Buffer.from(auth.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ScanRoute = {
  /** Shared with the web app as `DERIVER_SCAN_TOKEN`. */
  token: string;
  check: (bytes: Buffer, mime: string) => Promise<ScanVerdict>;
};

export type JobServerOptions = {
  handle: (photoId: string) => Promise<Reply>;
  /** The web app's scans; absent, `/scan` is a 404 like any unknown path. */
  scan?: ScanRoute;
  receiver: Receiver;
  /** The URL QStash was told to deliver to; must match the token's `sub`. */
  publicUrl: string;
};

export function createJobServer(options: JobServerOptions): Server {
  return createServer((request, response) => {
    void route(request, response, options).catch((err) => {
      // Nothing above this catches, so an unexpected throw must still become a
      // response — an unanswered request is a delivery QStash waits fifteen
      // minutes on before deciding it failed.
      send(response, {
        status: 500,
        body: err instanceof Error ? err.message : 'unhandled',
      });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: JobServerOptions,
): Promise<void> {
  const { handle, receiver, publicUrl } = options;
  const path = (request.url ?? '').split('?')[0];

  /*
   * A liveness check that touches nothing.
   *
   * Deliberately not a readiness check: it must not open a database
   * connection, because a machine that is awake only to answer health checks
   * is the polling loop this queue exists to remove, wearing a different name.
   */
  if (request.method === 'GET' && path === '/health') {
    return send(response, { status: 200, body: 'ok' });
  }

  if (path === SCAN_PATH && options.scan) return scanRoute(request, response, options.scan);
  if (path !== JOB_PATH) return send(response, { status: 404, body: 'not found' });
  if (request.method !== 'POST') {
    return send(response, { status: 405, body: 'POST only' });
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (err) {
    return send(response, {
      status: 400,
      body: err instanceof Error ? err.message : 'bad body',
      nonRetryable: true,
    });
  }

  const signature = request.headers['upstash-signature'];
  if (typeof signature !== 'string') {
    return send(response, { status: 401, body: 'missing signature' });
  }

  let valid = false;
  try {
    valid = await receiver.verify({ body, signature, url: publicUrl });
  } catch {
    // The SDK throws on a malformed token as well as returning false on a bad
    // one. Both are the same answer here.
    valid = false;
  }
  if (!valid) return send(response, { status: 401, body: 'bad signature' });

  let photoId: string;
  try {
    const parsed = JSON.parse(body) as { photoId?: unknown };
    if (typeof parsed.photoId !== 'string') throw new Error('photoId must be a string');
    photoId = parsed.photoId;
  } catch (err) {
    // Signed by us and still unreadable: a bug on the sending side, not a
    // transient fault. Retrying it would reproduce it every twelve seconds.
    return send(response, {
      status: 400,
      body: err instanceof Error ? err.message : 'bad json',
      nonRetryable: true,
    });
  }

  send(response, await handle(photoId));
}

/**
 * One image in, a verdict out — nothing stored, nothing published. The web app
 * decides what a match means for its image (quarantine, preservation, the
 * alert), exactly as it did when it asked Microsoft itself.
 *
 * 200 with the verdict; 503 when it could not be checked, which the web app
 * turns into a refused upload, never a clean one.
 */
async function scanRoute(request: IncomingMessage, response: ServerResponse, scan: ScanRoute): Promise<void> {
  if (request.method !== 'POST') return send(response, { status: 405, body: 'POST only' });
  if (!bearerIs(request, scan.token)) return send(response, { status: 401, body: 'unauthorised' });
  const mime = (request.headers['content-type'] ?? '').split(';')[0]!.trim();
  if (!mime.startsWith('image/')) return send(response, { status: 415, body: 'an image only' });

  let bytes: Buffer;
  try {
    bytes = await readBytes(request, SCAN_BODY_LIMIT);
  } catch (err) {
    // The rest is read and dropped rather than the socket cut, so the caller
    // hears the 413 instead of a reset. Safe to drain: the token was checked
    // before a byte of the body was read, so only the web app gets this far.
    return send(response, { status: 413, body: err instanceof Error ? err.message : 'bad body' });
  }
  if (bytes.length === 0) return send(response, { status: 400, body: 'empty' });

  try {
    const verdict = await scan.check(bytes, mime);
    // One line a scan, like a delivery's, and nothing about the image.
    console.log(`scanned     (web)  ${verdict.match ? 'MATCH' : 'no match'}`);
    return sendJson(response, 200, verdict);
  } catch (err) {
    if (err instanceof ScanUnavailable) {
      console.error(`scan-wait   (web)  ${err.message}`);
      return sendJson(response, 503, { error: 'scan_unavailable', detail: err.message });
    }
    throw err;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { 'content-type': 'text/plain' };
  // The documented way to tell QStash not to back off and try again: this,
  // with a 489. Without the header the status alone is just another failure.
  if (reply.nonRetryable) headers['Upstash-NonRetryable-Error'] = 'true';
  response.writeHead(reply.status, headers);
  response.end(reply.body);
}
