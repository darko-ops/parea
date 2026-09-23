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

import { Receiver } from '@upstash/qstash';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Reply } from './serve';

/** Where a delivery is expected. Anything else is a 404. */
export const JOB_PATH = '/jobs/photo';

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

export type JobServerOptions = {
  handle: (photoId: string) => Promise<Reply>;
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
  { handle, receiver, publicUrl }: JobServerOptions,
): Promise<void> {
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

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { 'content-type': 'text/plain' };
  // The documented way to tell QStash not to back off and try again: this,
  // with a 489. Without the header the status alone is just another failure.
  if (reply.nonRetryable) headers['Upstash-NonRetryable-Error'] = 'true';
  response.writeHead(reply.status, headers);
  response.end(reply.body);
}
