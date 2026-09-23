/**
 * The door, and who gets through it.
 *
 * `serve.test.ts` covers what happens to a photo once a delivery is accepted.
 * This covers accepting it: a real signature from a real `Receiver`, against a
 * real listening server, because the failure worth catching here is one where
 * verification is present and not actually checking anything.
 *
 * The signatures are minted with the same library that checks them, which is a
 * deliberate limitation to name: it proves the server verifies what QStash
 * would send in the shape QStash sends it, not that the library agrees with
 * QStash's servers. The claims that carry the risk — a tampered body, a wrong
 * key, a missing header — are exercised against that.
 */

import { Receiver } from '@upstash/qstash';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createJobServer, JOB_PATH } from '../src/http';
import type { Reply } from '../src/serve';

const CURRENT_KEY = `sig_${randomBytes(16).toString('hex')}`;
const NEXT_KEY = `sig_${randomBytes(16).toString('hex')}`;

let server: Server;
let base: string;
/** What the handler was asked to do, so a rejected request can be shown to do nothing. */
let asked: string[] = [];
let reply: Reply = { status: 200, body: 'ok' };

/**
 * A QStash-shaped token: HS256 over the header and claims, with the body's
 * SHA-256 in `body` and the destination in `sub`.
 */
function sign(options: { body: string; url: string; key?: string; sub?: string }): string {
  const b64 = (value: string | Buffer) =>
    Buffer.from(value).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({
      iss: 'Upstash',
      sub: options.sub ?? options.url,
      exp: now + 300,
      nbf: now - 5,
      iat: now,
      jti: randomBytes(8).toString('hex'),
      body: createHash('sha256').update(options.body).digest('base64url'),
    }),
  );
  const signature = createHmac('sha256', options.key ?? CURRENT_KEY)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function deliver(
  body: string,
  init: { signature?: string | null } = {},
): Promise<{ status: number; text: string; nonRetryable: boolean }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const signature =
    init.signature === undefined ? sign({ body, url: `${base}${JOB_PATH}` }) : init.signature;
  if (signature) headers['upstash-signature'] = signature;

  const res = await fetch(`${base}${JOB_PATH}`, { method: 'POST', headers, body });
  return {
    status: res.status,
    text: await res.text(),
    nonRetryable: res.headers.get('upstash-nonretryable-error') === 'true',
  };
}

beforeAll(async () => {
  server = createJobServer({
    handle: async (photoId) => {
      asked.push(photoId);
      return reply;
    },
    receiver: new Receiver({ currentSigningKey: CURRENT_KEY, nextSigningKey: NEXT_KEY }),
    // Set once the port is known, below.
    publicUrl: '',
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;

  // Rebuild with the URL now that there is one, since it is signed into every
  // token and has to match exactly.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server = createJobServer({
    handle: async (photoId) => {
      asked.push(photoId);
      return reply;
    },
    receiver: new Receiver({ currentSigningKey: CURRENT_KEY, nextSigningKey: NEXT_KEY }),
    publicUrl: `${base}${JOB_PATH}`,
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('a signed delivery', () => {
  it('reaches the handler and is answered by it', async () => {
    asked = [];
    reply = { status: 200, body: 'ready abc' };
    const res = await deliver(JSON.stringify({ photoId: 'abc' }));
    expect(res.status).toBe(200);
    expect(asked).toEqual(['abc']);
  });

  it('verifies against the next key too, so rotation does not drop deliveries', async () => {
    asked = [];
    const body = JSON.stringify({ photoId: 'rotated' });
    const res = await deliver(body, {
      signature: sign({ body, url: `${base}${JOB_PATH}`, key: NEXT_KEY }),
    });
    expect(res.status).toBe(200);
    expect(asked).toEqual(['rotated']);
  });

  it('verifies the bytes that arrived, not a re-serialisation of them', async () => {
    asked = [];
    /*
     * The signature covers a SHA-256 of the exact body sent, so verifying a
     * round-tripped copy compares a hash of different bytes. With bodies like
     * `{"photoId":"abc"}` that is invisible — `JSON.stringify(JSON.parse(x))`
     * gives back the same string — which is how a parse-then-verify bug ships
     * and then rejects every real delivery whose whitespace happens to differ.
     *
     * This body survives the round trip with different bytes, so it fails if
     * anything parses before it verifies.
     */
    const body = '{ "photoId": "spaced",\n  "note": "whitespace matters" }';
    expect(JSON.stringify(JSON.parse(body))).not.toBe(body);

    const res = await deliver(body, { signature: sign({ body, url: `${base}${JOB_PATH}` }) });
    expect(res.status).toBe(200);
    expect(asked).toEqual(['spaced']);
  });

  it('passes the handler’s non-retryable flag on as the header QStash reads', async () => {
    reply = { status: 489, body: 'failed', nonRetryable: true };
    const res = await deliver(JSON.stringify({ photoId: 'doomed' }));
    expect(res.status).toBe(489);
    expect(res.nonRetryable).toBe(true);
    reply = { status: 200, body: 'ok' };
  });
});

describe('an unsigned or tampered delivery', () => {
  it('is refused without a signature, and the handler never runs', async () => {
    asked = [];
    const res = await deliver(JSON.stringify({ photoId: 'nope' }), { signature: null });
    expect(res.status).toBe(401);
    // The assertion that matters: refusing is not enough if the work happened.
    expect(asked).toEqual([]);
  });

  it('is refused when signed with a key we do not hold', async () => {
    asked = [];
    const body = JSON.stringify({ photoId: 'forged' });
    const res = await deliver(body, {
      signature: sign({ body, url: `${base}${JOB_PATH}`, key: 'sig_not_ours' }),
    });
    expect(res.status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('is refused when the body changed after signing', async () => {
    asked = [];
    /*
     * The reason the raw bytes are verified before the JSON is parsed. A token
     * signed for one photo, replayed with another id in the body, must not be
     * treated as authorising the second.
     */
    const signedFor = JSON.stringify({ photoId: 'mine' });
    const res = await deliver(JSON.stringify({ photoId: 'yours' }), {
      signature: sign({ body: signedFor, url: `${base}${JOB_PATH}` }),
    });
    expect(res.status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('is refused when signed for a different destination', async () => {
    asked = [];
    const body = JSON.stringify({ photoId: 'elsewhere' });
    const res = await deliver(body, {
      signature: sign({
        body,
        url: `${base}${JOB_PATH}`,
        sub: 'https://someone-elses-worker.fly.dev/jobs/photo',
      }),
    });
    expect(res.status).toBe(401);
    expect(asked).toEqual([]);
  });
});

describe('the shape of a request', () => {
  it('answers health without touching the handler', async () => {
    asked = [];
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(asked).toEqual([]);
  });

  it('404s an unknown path and 405s the wrong method', async () => {
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
    expect((await fetch(`${base}${JOB_PATH}`)).status).toBe(405);
  });

  it('rejects a signed body with no photo id, without asking for a retry', async () => {
    asked = [];
    const res = await deliver(JSON.stringify({ notAPhoto: true }));
    expect(res.status).toBe(400);
    expect(res.nonRetryable).toBe(true);
    expect(asked).toEqual([]);
  });
});

/**
 * The one string that has to be identical in two places.
 *
 * QStash signs the destination into every token, so the deriver verifies
 * against the URL the *sender* used. `DERIVER_JOB_URL` in the web app's
 * environment and `DERIVER_PUBLIC_URL` in `fly.toml` are that URL written
 * twice, and a mismatch does not degrade anything — it rejects every genuine
 * delivery with a 401, which QStash retries and then sends to the dead letter
 * queue. Nothing is derived and the logs say "bad signature", which points at
 * the keys rather than at the URL.
 */
describe('where deliveries are sent and where they are expected', () => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

  it('are the same URL in the app config and the machine config', () => {
    const sends = /^DERIVER_JOB_URL=(.+)$/m.exec(read('../../../apps/web/.env.example'));
    const expects = /DERIVER_PUBLIC_URL = "(.+)"/.exec(read('../fly.toml'));

    expect(sends?.[1], 'DERIVER_JOB_URL missing from .env.example').toBeTruthy();
    expect(expects?.[1], 'DERIVER_PUBLIC_URL missing from fly.toml').toBeTruthy();
    expect(sends![1]).toBe(expects![1]);
  });

  it('name the path the server actually serves', () => {
    // Three ways to write the same route, and only one of them is executable.
    const expects = /DERIVER_PUBLIC_URL = "(.+)"/.exec(read('../fly.toml'))?.[1];
    expect(expects).toBeTruthy();
    expect(new URL(expects!).pathname).toBe(JOB_PATH);
  });

  it('point at the port the container exposes', () => {
    const internal = /internal_port = (\d+)/.exec(read('../fly.toml'))?.[1];
    expect(internal).toBeTruthy();
    expect(read('../Dockerfile')).toContain(`EXPOSE ${internal}`);
  });
});
