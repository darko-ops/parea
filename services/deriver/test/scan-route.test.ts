/**
 * `/scan`: the web app's images, checked here. A real listening server, as in
 * `http.test.ts`, because what matters is that the token is actually checked
 * and that "could not check" never comes back looking like "clean".
 */

import { Receiver } from '@upstash/qstash';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createJobServer, SCAN_PATH } from '../src/http';
import { ScanUnavailable } from '../src/safety';

const TOKEN = randomBytes(24).toString('hex');
let server: Server;
let base: string;
let seen: { bytes: number; mime: string }[] = [];
let answer: () => Promise<unknown> = async () => ({ match: false });

beforeAll(async () => {
  server = createJobServer({
    handle: async () => ({ status: 200, body: 'ok' }),
    receiver: new Receiver({ currentSigningKey: 'sig_a', nextSigningKey: 'sig_b' }),
    publicUrl: 'https://deriver.test/jobs/photo',
    scan: {
      token: TOKEN,
      check: async (bytes, mime) => {
        seen.push({ bytes: bytes.length, mime });
        return (await answer()) as never;
      },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  seen = [];
  answer = async () => ({ match: false });
});

const scan = (init: { token?: string; type?: string; body?: Buffer | string; method?: string } = {}) =>
  fetch(`${base}${SCAN_PATH}`, {
    method: init.method ?? 'POST',
    headers: {
      ...(init.token === undefined ? { authorization: `Bearer ${TOKEN}` } : init.token ? { authorization: `Bearer ${init.token}` } : {}),
      'content-type': init.type ?? 'image/jpeg',
    },
    body: init.method === 'GET' ? undefined : (init.body ?? Buffer.from('jpeg bytes')),
  });

describe('the scan route', () => {
  it('answers the verdict for an image sent with the token', async () => {
    const res = await scan();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ match: false });
    expect(seen).toEqual([{ bytes: 10, mime: 'image/jpeg' }]);

    answer = async () => ({ match: true, classification: 'A1', providerReference: 'tr-1' });
    expect(await (await scan()).json()).toEqual({ match: true, classification: 'A1', providerReference: 'tr-1' });
  });

  it('checks nothing without the right token', async () => {
    expect((await scan({ token: '' })).status).toBe(401);
    expect((await scan({ token: 'x'.repeat(48) })).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('says it could not check, never that it is clean, when scanning fails', async () => {
    answer = async () => {
      throw new ScanUnavailable('photodna returned HTTP 429');
    };
    const res = await scan();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'scan_unavailable' });
  });

  it('takes only an image, by POST, under five megabytes', async () => {
    expect((await scan({ type: 'text/plain' })).status).toBe(415);
    expect((await scan({ method: 'GET' })).status).toBe(405);
    expect((await scan({ body: Buffer.alloc(6 * 1024 * 1024) })).status).toBe(413);
    expect((await scan({ body: Buffer.alloc(0) })).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
});

describe('without a scan route', () => {
  it('is an unknown path, like any other', async () => {
    const bare = createJobServer({
      handle: async () => ({ status: 200, body: 'ok' }),
      receiver: new Receiver({ currentSigningKey: 'sig_a', nextSigningKey: 'sig_b' }),
      publicUrl: 'https://deriver.test/jobs/photo',
    });
    await new Promise<void>((resolve) => bare.listen(0, resolve));
    const port = (bare.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}${SCAN_PATH}`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(404);
    await new Promise<void>((resolve) => bare.close(() => resolve()));
  });
});
