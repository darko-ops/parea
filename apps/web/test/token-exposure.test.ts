/**
 * The actor token is not handed to a browser.
 *
 * The cookie is `httpOnly` so that a script on the page cannot read who you
 * are and keep it. That is worth nothing if a same-origin `fetch` answers with
 * the same signed string, and two routes used to do exactly that — harmless
 * while only the app called them, and less so now that the web has a sign-in
 * page and the value names a person rather than a throwaway guest.
 *
 * Asserted here rather than in the routes because the routes need a database
 * and this does not: what can regress is the discrimination itself, and it is
 * a pure function of what the caller presented.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
  }),
  headers: async () => ({
    get: (name: string) => headerBag.get(name.toLowerCase()) ?? null,
  }),
}));

const { ACTOR_COOKIE, sign } = await import('../src/auth/cookies');
const { fromBrowser } = await import('../src/session');

beforeEach(() => {
  cookieJar.clear();
  headerBag.clear();
});

describe('fromBrowser', () => {
  it('is true for a fetch from a page', async () => {
    // `Sec-` headers are forbidden header names, so a script can neither add
    // nor remove them. This is the browser's word, not the caller's.
    headerBag.set('sec-fetch-mode', 'cors');
    headerBag.set('sec-fetch-site', 'same-origin');
    expect(await fromBrowser()).toBe(true);
  });

  it('is false for the native client', async () => {
    // A bearer header and no fetch metadata. Native has to keep receiving the
    // token: the keychain is where its identity lives.
    headerBag.set('authorization', `Bearer ${sign('actor-1')}`);
    expect(await fromBrowser()).toBe(false);
  });

  it('is false for a native client that picked up a cookie', async () => {
    // The reason the cookie is not one of the signals. React Native shares
    // the platform cookie store on both iOS and Android, so the app sends
    // back a cookie the server once set — and an app denied its own token is
    // an app that cannot stay signed in.
    cookieJar.set(ACTOR_COOKIE, sign('actor-1'));
    headerBag.set('authorization', `Bearer ${sign('actor-1')}`);
    expect(await fromBrowser()).toBe(false);
  });
});
