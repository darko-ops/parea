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

/**
 * One identity per client, and the phone's is the token.
 *
 * `currentActorId` reads the actor cookie *before* the bearer token, which is
 * right for a browser and a trap for anything else: iOS keeps a shared cookie
 * jar and `fetch` uses it without being asked, so a single `Set-Cookie`
 * anywhere in the API gives the app a second identity it did not ask for and
 * cannot clear.
 *
 * What that cost, and why this is a test rather than a comment: signing out on
 * the phone cleared the token, the keychain and every screen — and the next
 * request arrived as the person who had just signed out, because the cookie
 * outranked everything the client had thrown away. Their groups and their
 * profile came back from the server. It looks exactly like a client that failed
 * to clear its own state, and it is not.
 */
describe('the phone is its token and nothing else', () => {
  const read = async (path: string) => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  };

  it('mints an actor cookie only for a browser', async () => {
    /*
     * The rule was already written down one route away, at sign-in: "browsers
     * only: native carries the same value as a bearer token and has no cookie
     * jar worth writing to". `ensureActor` did not follow it.
     */
    const session = await read('../src/session.ts');
    expect(session).toMatch(/if \(await fromBrowser\(\)\) await issueActorCookie/);
    // And the preference is unchanged, because it is correct for the browser
    // this file was written for.
    expect(session).toMatch(/jar\.get\(ACTOR_COOKIE\)\?\.value\) \?\? \(await bearerActorId\(\)\)/);
  });

  it('sends no cookie from the app, whatever the server sets', async () => {
    // Belt and braces, and the half that does not depend on every future route
    // remembering the rule above.
    const api = await read('../../mobile/src/api.ts');
    expect(api).toMatch(/credentials: 'omit'/);
    // One place makes every request, so one line covers all of them.
    expect((api.match(/await fetch\(/g) ?? [])).toHaveLength(1);
  });
});
