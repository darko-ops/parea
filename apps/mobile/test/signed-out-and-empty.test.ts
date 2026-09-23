/**
 * What the app shows when there is nobody signed in, and when there is nobody
 * signed in yet *and* nothing to show.
 *
 * Two questions that used to be answered by leaving the space blank. A shelf
 * with no albums on it was an empty run of page; a chats tab with no chats
 * pointed at a different tab; a profile signed out drew a header for nobody
 * over a grid of nothing. None of those read as "there is nothing here yet" —
 * they read as a screen that failed.
 *
 * The gate is the larger change and it reverses a documented one. Design §3
 * has accounts "optional, asked for only after value has been delivered", and
 * the four tabs were built to work without one. They are behind sign-in now.
 * What is *not* behind it is the thing the rule was protecting: an album
 * someone was sent still opens from its link, because that arrives as its own
 * screen rather than through a tab.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const EVENTS = read('src/Events.tsx');
const PROFILE = read('src/Profile.tsx');

/** The chats tab, which is where the empty-room prompt lives. */
const CHATS = EVENTS.slice(
  EVENTS.indexOf('export function ChatsTab'),
  EVENTS.indexOf('function GroupBlock'),
);
/** Find, whose two paragraphs of policy are gone. */
const FIND = EVENTS.slice(
  EVENTS.indexOf('export function SearchTab'),
  EVENTS.indexOf('function Result('),
);

describe('the tabs need an account', () => {
  it('draws the gate instead of the four panes', () => {
    // Both halves, and they must not overlap: `!== true` covers the gate and
    // `=== true` the tabs, so the unknown answer falls to neither.
    expect(APP).toMatch(/route\.screen === 'tabs' && signedIn !== true &&/);
    expect(APP).toMatch(/route\.screen === 'tabs' && signedIn === true &&/);
  });

  it('waits rather than flashing a prompt at somebody already signed in', () => {
    // `signedIn` is `boolean | null`, and null is "not back yet".
    const gate = APP.slice(APP.indexOf("route.screen === 'tabs' && signedIn !== true"));
    expect(gate.slice(0, gate.indexOf('</ScrollView>'))).toMatch(
      /signedIn === null \? \(\s*\n\s*<View style=\{\[styles\.center/,
    );
  });

  it('leaves a link to an album alone', () => {
    /*
     * The one thing the old rule was protecting, and the reason the gate is on
     * the tabs rather than on the app. An event is its own route, reached from
     * `arrive` — nothing on it consults `signedIn`.
     */
    const event = APP.slice(
      APP.indexOf("route.screen === 'event' &&"),
      APP.indexOf("The sign-in gate, on both steps"),
    );
    expect(event).toMatch(/<EventScreen/);
    expect(event).not.toMatch(/signedIn !== true|signedIn === false/);
    // And the route is still set by a tapped link, without an account check.
    expect(APP).toMatch(/const arrival = arrivalFromUrl\(url\);/);
  });

  it('discards whatever the tabs were holding on the way in', () => {
    // Signing in is a change of identity; see `identity` in App.tsx.
    const gate = APP.slice(APP.indexOf("route.screen === 'tabs' && signedIn !== true"));
    const card = gate.slice(0, gate.indexOf('</ScrollView>'));
    expect(card).toMatch(/setIdentity\(\(n\) => n \+ 1\)/);
    expect(card).toMatch(/void refreshAccount\(\)/);
  });
});

describe('a shelf with nothing on it', () => {
  it('says so, and offers the one thing that answers it', () => {
    expect(PROFILE).toMatch(/No Albums Yet\. Create One Now\./);
    const empty = PROFILE.slice(PROFILE.indexOf('styles.noAlbums'));
    expect(empty.slice(0, empty.indexOf('</View>'))).toMatch(/onPress=\{onCreateEvent\}/);
  });

  it('goes the moment there is one', () => {
    // Guarded on the count rather than toggled by the press: a prompt that
    // hid itself would stay hidden for an album that failed to be made.
    expect(PROFILE).toMatch(/\{account && events\.length === 0 && \(/);
    expect(PROFILE).toMatch(/\{events\.length > 0 && \(\s*\n\s*<View style=\{\[styles\.grid/);
  });
});

describe('a chats tab with no chats', () => {
  it('leads with the fact and keeps the explanation under it', () => {
    const at = CHATS.indexOf('No chats yet.');
    expect(at).toBeGreaterThan(-1);
    // The paragraph follows it rather than replacing it.
    expect(CHATS.slice(at)).toMatch(/Every group you are in has one\./);
  });

  it('offers a room rather than directions to another tab', () => {
    expect(CHATS).toMatch(/label="Create group chat"[\s\S]{0,40}onPress=\{onCreateGroup\}/);
    // The way out that used to stand here, and the prop that fed it.
    expect(CHATS).not.toMatch(/Your albums/);
    expect(CHATS).not.toMatch(/onGoToEvents/);
    expect(APP).not.toMatch(/onGoToEvents/);
  });
});

describe('Find says less', () => {
  it('states the fact about groups and stops', () => {
    expect(FIND).toMatch(/You are not in any groups yet\./);
    expect(FIND).not.toMatch(/once you have shared a couple of albums/);
    expect(FIND).not.toMatch(/asking to be let in/);
  });

  it('carries no policy footnote', () => {
    // See `find.test.ts` for what went with it — the only place in the app
    // that said albums are not searchable. Still true, no longer stated here.
    expect(FIND).not.toMatch(/Handles and findable groups only/);
    expect(EVENTS).not.toMatch(/footnote/);
  });
});

describe('the profile, with no picture on it', () => {
  it('draws the frame the picture will take, bleed and all', () => {
    // Not a disc in the gutter: the two are one outline with different
    // contents. `profile.test.ts` holds the numbers.
    const blank = PROFILE.slice(PROFILE.indexOf('avatarBlank: {'));
    const box = blank.slice(0, blank.indexOf('}'));
    expect(box).toMatch(/width: 124/);
    expect(box).toMatch(/height: 104/);
    expect(box).not.toMatch(/borderRadius: 32|marginRight/);
  });

  it('gives both halves of the row the same outline', () => {
    /*
     * `Share profile` was a hairline over `card`, which beside an ink-bordered
     * `Edit profile` reads as the row's disabled half rather than its second
     * control. Neither is the screen's primary action, so neither is filled.
     */
    const row = PROFILE.slice(
      PROFILE.indexOf('<View style={[styles.actions, styles.gutter]}>'),
      PROFILE.indexOf('Not signed in: the card that asks'),
    );
    expect(row.match(/borderColor: t\.fg/g) ?? []).toHaveLength(2);
    expect(row).not.toMatch(/backgroundColor: t\.card/);
  });
});
