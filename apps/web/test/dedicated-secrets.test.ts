/**
 * Keys that must be their own in production. See `dedicatedSecret`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { dedicatedSecret, missingInProduction } from '../src/env';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('keys that must be their own', () => {
  it('never borrow the session secret in production', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.SESSION_SECRET = 'session';
    delete process.env.IMAGE_SECRET;
    delete process.env.MANIFEST_SECRET;
    delete process.env.PHONE_PEPPER;
    expect(dedicatedSecret('IMAGE_SECRET')).toBeUndefined();
    expect(dedicatedSecret('MANIFEST_SECRET')).toBeUndefined();
    expect(dedicatedSecret('PHONE_PEPPER')).toBeUndefined();
    // And the health check names them as missing.
    const missing = missingInProduction().map((c) => c.name);
    expect(missing).toEqual(expect.arrayContaining(['IMAGE_SECRET', 'MANIFEST_SECRET', 'PHONE_PEPPER']));
  });

  it('use their own value wherever they have one', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.IMAGE_SECRET = 'image';
    expect(dedicatedSecret('IMAGE_SECRET')).toBe('image');
  });

  it('still fall back in previews and local development', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SESSION_SECRET = 'session';
    delete process.env.PHONE_PEPPER;
    expect(dedicatedSecret('PHONE_PEPPER')).toBe('session');
  });
});
