/**
 * A browser request that changes something is refused when it came from
 * another site — the defence against forced sign-in. See `proxy.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { allowedSource, config } from '../proxy';

const PROXY = readFileSync(fileURLToPath(new URL('../proxy.ts', import.meta.url)), 'utf8');

const request = (method: string, headers: Record<string, string> = {}) => ({
  method,
  url: 'https://www.parea.photos/api/account/session',
  headers: new Headers(headers),
});

describe('which requests may change something', () => {
  it('refuses a page elsewhere, the shape of a forced sign-in', () => {
    // An auto-submitting form on another site: the browser says so.
    expect(allowedSource(request('POST', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(allowedSource(request('DELETE', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });

  it('lets Parea itself through, from any of its own hosts', () => {
    expect(allowedSource(request('POST', { 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(allowedSource(request('POST', { 'sec-fetch-site': 'same-site' }))).toBe(true);
    expect(allowedSource(request('POST', { 'sec-fetch-site': 'none' }))).toBe(true);
  });

  it('falls back to Origin for a browser that does not say where it was', () => {
    expect(allowedSource(request('POST', { origin: 'https://evil.example' }))).toBe(false);
    expect(allowedSource(request('POST', { origin: 'null' }))).toBe(false);
    expect(allowedSource(request('POST', { origin: 'https://www.parea.photos' }))).toBe(true);
    expect(allowedSource(request('POST', { origin: 'https://parea.photos' }))).toBe(true);
  });

  it('leaves the phone app and servers alone', () => {
    // Neither header: not a browser, so there is no ambient cookie to spend.
    expect(allowedSource(request('POST', { authorization: 'Bearer x' }))).toBe(true);
  });

  it('never stands in the way of reading', () => {
    expect(allowedSource(request('GET', { 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });

  it('runs on the API, and on pages only for the sign-in gate', () => {
    // The cross-site check is for the API; pages pass through the proxy so it
    // can send a visitor with no session to sign in — see `@/gate`.
    expect(config.matcher).toContain('/api/:path*');
    expect(PROXY).toMatch(/if \(pathname\.startsWith\('\/api\/'\)\) \{\s*if \(allowedSource\(request\)\)/);
  });
});
