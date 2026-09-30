/**
 * Where the limits read the caller from, and what happens when they cannot
 * count.
 */

import { describe, expect, it, vi } from 'vitest';

const headerBag = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { sourceKey, withinLimit, withinLimitFor, SIGN_IN_VERIFY_LIMIT, SIGN_IN_VERIFY_ADDRESS_LIMIT, PHONE_VERIFY_LIMIT, JOIN_CODE_LIMIT, PLACES_LIMIT } =
  await import('../src/ratelimit');

/** A database that cannot count. */
const broken = { execute: async () => { throw new Error('down'); } } as never;

describe('rate limits', () => {
  it('read the address Vercel sets, which a caller cannot supply', async () => {
    headerBag.clear();
    headerBag.set('x-vercel-forwarded-for', '203.0.113.7');
    headerBag.set('x-forwarded-for', '198.51.100.1');
    const trusted = await sourceKey('secret');
    headerBag.delete('x-forwarded-for');
    expect(await sourceKey('secret')).toBe(trusted);
  });

  it('refuse a guess at a secret when the count cannot be taken', async () => {
    headerBag.set('x-vercel-forwarded-for', '203.0.113.7');
    for (const limit of [SIGN_IN_VERIFY_LIMIT, PHONE_VERIFY_LIMIT, JOIN_CODE_LIMIT]) {
      expect(await withinLimit(broken, limit, 'secret'), limit.name).toBe(false);
    }
    expect(await withinLimitFor(broken, SIGN_IN_VERIFY_ADDRESS_LIMIT, 'secret', 'a@b.c')).toBe(false);
  });

  it('let everything else through, so a database blip does not take the site down', async () => {
    expect(await withinLimit(broken, PLACES_LIMIT, 'secret')).toBe(true);
  });
});
