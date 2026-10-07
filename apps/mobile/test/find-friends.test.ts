/**
 * Find Friends on the phone, and the three claims it has to keep.
 *
 * **It does not touch the address book.** The obvious build of this screen is a
 * contacts permission and an upload, and the reason this one refuses is not
 * squeamishness: an uploaded address book is a list of people who never agreed
 * to anything. That promise is one permission string away from being broken by
 * accident, so it is asserted against the manifest rather than trusted to the
 * screen.
 *
 * **The number is asked for and never kept.** Nothing in this client holds the
 * digits after the request that sends them, and nothing in it ever receives
 * them back — an account carries two digits and a boolean.
 *
 * **The corner of Find changed hands, and Lately is still reachable.** The tray
 * moved off this tab, which is only defensible because Home still carries it.
 *
 * Source checks where there is no renderer in this suite, and real requests
 * through the client where the wire is what is in question. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import { reasonFor } from '../src/answers';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const SCREEN = read('src/FindFriends.tsx');
const APP = read('App.tsx');
const EVENTS = read('src/Events.tsx');
const PROFILE = read('src/Profile.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    // 204 carries no body, and `Response` refuses to be constructed with one —
    // which the client has to survive, because two of these routes answer 204.
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status });
  });
  return calls;
}

describe('no address book', () => {
  it('asks for no contacts permission anywhere in the app', () => {
    /*
     * The whole design rests on this, and no assertion about behaviour can
     * protect it: a `NSContactsUsageDescription` and an `expo-contacts` import
     * is two lines away at any time. Checked against the manifest and the
     * dependency list, which are the two places it would have to appear before
     * any code could ask.
     */
    const manifest = read('app.json');
    const pkg = read('package.json');
    for (const source of [manifest, pkg, SCREEN, code(APP)]) {
      expect(source).not.toMatch(/Contacts|CONTACTS|expo-contacts/);
    }
  });

  it('says so on the screen, rather than only in the code', () => {
    // Somebody arriving here has met this screen in three other products and
    // expects the permission dialog. Not asking is worth saying out loud.
    expect(SCREEN).toMatch(/we do not read your contacts/i);
  });
});

describe('the number', () => {
  it('goes out to be verified and never comes back', async () => {
    const calls = respond({ sent: true, last2: '77' });
    const api = new Api('https://api.test', 'signed-actor');

    expect(await api.startPhone('+44 7700 900123')).toEqual({ sent: true, last2: '77' });
    expect(calls[0]!.url).toBe('https://api.test/api/account/phone');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ phone: '+44 7700 900123' });
  });

  it('is claimed by presenting the code alone', async () => {
    /*
     * The code and nothing else. Sending the number again would be the server
     * matching two things the caller supplied against each other, which proves
     * nothing — and would put the digits on the wire a second time for it.
     */
    const calls = respond({ last2: '77', verified: true });
    await new Api('https://api.test', 'a').verifyPhone('123456');

    expect(calls[0]!.url).toBe('https://api.test/api/account/phone/verify');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ code: '123456' });
  });

  it('is given back through the same route it was offered on', async () => {
    const calls = respond(null, 204);
    await new Api('https://api.test', 'a').removePhone();
    expect(calls[0]!.url).toBe('https://api.test/api/account/phone');
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('is never held in this client past the request that sends it', () => {
    /*
     * The field is cleared on success and the screen keeps two digits, which is
     * all the server would hand back anyway. A `phone` left standing in state
     * would be the one copy of somebody's number in the product that outlives
     * its request — on the device, in a state tree, for as long as the app runs.
     */
    expect(SCREEN).toMatch(/setPhone\(''\)/);
    // Nothing writes the number anywhere that persists. The screen has no store
    // of its own and must not grow one for this.
    expect(SCREEN).not.toMatch(/AsyncStorage|SecureStore|setItemAsync/);
  });
});

describe('the reason a row gives', () => {
  it('leads with mutual friends, which is the strongest of the three', () => {
    // Other people having already vouched. An album is "we were in the same
    // room"; a group is only "we are both on a list".
    expect(reasonFor({ actorId: 'a', handle: 'x', displayName: null, avatar: null, mutuals: 2, albums: 5, groups: 3 }))
      .toBe('2 mutual friends');
  });

  it('counts one properly, in all three', () => {
    const one = { actorId: 'a', handle: 'x', displayName: null, avatar: null };
    expect(reasonFor({ ...one, mutuals: 1 })).toBe('1 mutual friend');
    expect(reasonFor({ ...one, mutuals: 0, albums: 1 })).toBe('In a roll with you');
    expect(reasonFor({ ...one, mutuals: 0, albums: 0, groups: 1 })).toBe('In a group with you');
  });

  it('falls back to a sentence rather than a zero', () => {
    /*
     * The server never sends a row with all three at nought — a row is on the
     * list because one of them is not. This is for the day an old build talks to
     * a new server, or a new build to an old one: the alternative is a row
     * reading "0 mutual friends", which is worse than vague.
     */
    expect(reasonFor({ actorId: 'a', handle: 'x', displayName: null, avatar: null }))
      .toBe('You may know them');
  });
});

describe('the corner of Find', () => {
  it('holds the way to this screen', () => {
    const find = EVENTS.slice(
      EVENTS.indexOf('export function SearchTab'),
      EVENTS.indexOf('export function AccountCard'),
    );
    expect(find).toMatch(/accessibilityLabel="Find friends"/);
    expect(find).toMatch(/onPress=\{onFindFriends\}/);
  });

  it('left Lately reachable from the tab anybody opens the app on', () => {
    /*
     * The only thing that makes moving the tray off Find defensible. "Somebody
     * is waiting on you" has to stay one press from somewhere, and Home is where
     * the app opens.
     */
    const home = EVENTS.slice(
      EVENTS.indexOf('export function HomeTab'),
      EVENTS.indexOf('export function ChatsTab'),
    );
    expect(home).toMatch(/<Notifications t=\{t\} count=\{waiting\}/);
  });

  it('is a screen pushed over the tabs, with the app’s own gesture', () => {
    // Somewhere you go and come back from, not a task to finish or abandon — so
    // a push with the same swipe as every other, rather than a modal.
    expect(APP).toMatch(/screen: 'findFriends'/);
    expect(code(APP)).toMatch(/<SwipeBack onBack=\{leaveToTabs\}>\s*<FindFriends/);
  });
});

describe('what the screen will not draw', () => {
  it('shows nobody until a number is proved', () => {
    /*
     * The gate is the server's — it sends no people without one — and the screen
     * agrees rather than relying on that. Two halves of a page, one asking for
     * something and the other already doing the thing, is a page arguing with
     * itself.
     */
    expect(SCREEN).toMatch(/const verified = state\?\.phone\.verified === true;/);
    expect(SCREEN).toMatch(/\{verified && \(/);
    expect(SCREEN).toMatch(/const asking = state !== null && !verified && sentTo === null;/);
    expect(SCREEN).toMatch(/\{asking && \(/);
    expect(SCREEN).toMatch(/\{!verified && !asking && \(/);
  });

  it('asks with the whole page, the country code as its own control', () => {
    expect(SCREEN).toContain('Let people who have your number find you');
    expect(SCREEN).toMatch(/<Glyph name="add-person" size=\{34\}/);
    expect(SCREEN).toMatch(/api\.startPhone\(fullNumber\(country, phone\)\)/);
    expect(SCREEN).toMatch(/disabled=\{busy \|\| !smsAgreed \|\| nationalDigits < 6\}/);
    expect(SCREEN).toContain('Search on Find');
    // Only the countries the server texts.
    expect(SCREEN).toMatch(/region: 'US'.*\n.*region: 'CA'.*\n.*region: 'GB'/);
  });

  it('tells "nobody yet" apart from "could not load"', () => {
    // Two different sentences, and only one of them is worth a retry under.
    expect(SCREEN).toMatch(/Nobody new to suggest right now/);
    expect(SCREEN).toMatch(/Could not load this/);
  });

  it('says what adding a number switched on, and where to switch it off', () => {
    // Adding a number made somebody findable. The honest place to say so is the
    // screen that did it, not a settings sheet they may never open.
    expect(SCREEN).toMatch(/People who have it can find you — turn that off in Settings/);
  });
});

describe('the switch that turns it off', () => {
  it('is in Settings, in the words the privacy page uses', () => {
    expect(PROFILE).toMatch(
      /Let people who have my phone number or email find me on Parea/,
    );
  });

  it('does not promise to hide anything else', () => {
    /*
     * It is not general invisibility. The handle search still finds you, and so
     * do the friends of your friends, who can see you on a mutual friend's list
     * already — so the sub-line says so rather than letting somebody read this
     * as a way to disappear.
     */
    expect(PROFILE).toMatch(/People can still find you by your handle/);
  });

  it('goes through the account route rather than one of its own', async () => {
    // One column on the row the profile fields live on. A route per switch is a
    // route per switch to get the session check wrong in.
    const calls = respond({ ok: true });
    await new Api('https://api.test', 'a').setDiscoverable(false);
    expect(calls[0]!.url).toBe('https://api.test/api/account');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ discoverable: false });
  });

  it('reads an absent field as on, so it never lies about being private', () => {
    /*
     * A build outlives the server it talks to. Against a deploy from before this
     * column shipped the field is simply absent, and undefined has to read as on
     * — the alternative is a switch drawn off, telling somebody their number is
     * private when it is not.
     */
    expect(PROFILE).toMatch(/account\.discoverable !== false/);
  });
});
