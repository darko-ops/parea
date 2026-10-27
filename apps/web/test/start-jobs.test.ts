/**
 * What starts the hourly clean-up: Vercel's cron, through Fly's Machines API,
 * and an error in Sentry when Fly will not.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured: string[] = [];
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string) => captured.push(message),
  flush: async () => true,
}));

const { GET } = await import('../app/api/cron/start-jobs/route');

const MACHINE = 'https://api.machines.dev/v1/apps/parea-jobs/machines/80e903db077048';

type Call = { url: string; method: string; authorization: string | null };
let calls: Call[];
let answers: Record<string, () => Response>;

beforeEach(() => {
  captured.length = 0;
  calls = [];
  answers = {
    [`GET ${MACHINE}`]: () => Response.json({ state: 'stopped' }),
    [`POST ${MACHINE}/start`]: () => Response.json({ previous_state: 'stopped' }),
  };
  process.env.CRON_SECRET = 'cron-secret';
  process.env.FLY_JOBS_TOKEN = 'FlyV1 fm2_test';
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push({ url: input, method, authorization: headers.get('authorization') });
    const answer = answers[`${method} ${input}`];
    if (!answer) throw new Error(`unexpected ${method} ${input}`);
    return answer();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (auth = 'Bearer cron-secret') =>
  GET(new Request('https://parea.test/api/cron/start-jobs', { headers: { authorization: auth } }));

describe('starting the hourly clean-up', () => {
  it('answers only the scheduler', async () => {
    expect((await call('Bearer wrong')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('starts the stopped machine, with the token as Fly prints it', async () => {
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, started: true, previous: 'stopped' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${MACHINE}`, `POST ${MACHINE}/start`]);
    expect(calls[1]!.authorization).toBe('FlyV1 fm2_test');
    expect(captured).toHaveLength(0);
  });

  it('sends an older plain token as a bearer', async () => {
    process.env.FLY_JOBS_TOKEN = 'plain';
    await call();
    expect(calls[0]!.authorization).toBe('Bearer plain');
  });

  it('leaves a machine that is still running alone, quietly', async () => {
    answers[`GET ${MACHINE}`] = () => Response.json({ state: 'started' });
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, started: false, state: 'started' });
    expect(calls).toHaveLength(1);
    expect(captured).toHaveLength(0);
  });

  it('raises an error when Fly refuses the start', async () => {
    answers[`POST ${MACHINE}/start`] = () => new Response('{"error":"failed to start"}', { status: 500 });
    const res = await call();
    expect(res.status).toBe(502);
    expect(captured).toEqual(['The hourly clean-up was not started']);
  });

  it('raises an error when the token is refused', async () => {
    answers[`GET ${MACHINE}`] = () => new Response('unauthorized', { status: 401 });
    expect((await call()).status).toBe(502);
    expect(captured).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('raises an error when Fly does not answer at all', async () => {
    answers[`GET ${MACHINE}`] = () => {
      throw new TypeError('fetch failed');
    };
    expect((await call()).status).toBe(502);
    expect(captured).toHaveLength(1);
  });

  it('raises an error, rather than doing nothing, without a token', async () => {
    delete process.env.FLY_JOBS_TOKEN;
    expect((await call()).status).toBe(503);
    expect(captured).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('runs at :00 with the other crons', () => {
    const vercel = JSON.parse(
      readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
    ) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: '/api/cron/start-jobs', schedule: '0 * * * *' });
  });
});
