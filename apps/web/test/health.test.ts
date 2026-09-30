/**
 * The health check: "up" for anybody, the full check for the operator.
 */

import { describe, expect, it, vi } from 'vitest';

const queried: string[] = [];
vi.mock('@/db', () => ({
  getDb: () => ({ execute: async () => void queried.push('select 1') }),
}));

const { GET } = await import('../app/api/health/route');

const call = (auth?: string) =>
  GET(new Request('https://parea.test/api/health', auth ? { headers: { authorization: auth } } : {}));

describe('the health check', () => {
  it('tells anybody the site is up, and touches nothing to do it', async () => {
    process.env.HEALTH_TOKEN = 'health-token';
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    // No query: a monitor pinging this must not keep the database awake.
    expect(queried).toHaveLength(0);
  });

  it('gives the operator the database and every setting', async () => {
    process.env.HEALTH_TOKEN = 'health-token';
    const body = (await (await call('Bearer health-token')).json()) as Record<string, unknown>;
    expect(body.database).toBe(true);
    expect(Array.isArray(body.config)).toBe(true);
    expect(queried).toHaveLength(1);
  });

  it('never gives the full answer without a token configured', async () => {
    delete process.env.HEALTH_TOKEN;
    expect(await (await call('Bearer ')).json()).toEqual({ status: 'ok' });
  });
});
