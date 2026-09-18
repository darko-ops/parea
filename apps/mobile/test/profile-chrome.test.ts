/**
 * The two corners of the profile, and what moved to make room for them.
 *
 * The screen had one row of chrome — `Edit profile` and `Settings`, under the
 * bio — and nothing in either corner. So the quietest thing on the page sat
 * beside the loudest at the same size, there was no way to hand somebody your
 * own profile, and the tab whose subject is everything you have made was the
 * one tab with no way to make anything.
 *
 * Settings is a `⋯` in the top-left now, the `+` opposite it makes an album or
 * a group, and the half-row Settings vacated is `Share profile`.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const PROFILE = read('src/Profile.tsx');
const APP = read('App.tsx');
const EVENTS = read('src/Events.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREEN = code(
  PROFILE.slice(PROFILE.indexOf('export function ProfileScreen'), PROFILE.indexOf('function Settings(')),
);

describe('the two corners', () => {
  it('puts settings behind the same glyph an album uses', () => {
    /*
     * One shape in the product that means "everything else about this thing".
     * The album's own settings are behind a `⋯` in its corner and have been
     * since the slabs came off that screen.
     */
    expect(SCREEN).toMatch(/<PageHead/);
    expect(SCREEN).toMatch(/accessibilityLabel="Settings"/);
    // The `⋯` itself lives in `RoundButton` now, so that every corner drawing
    // one agrees about its size — the profile's was 22pt and the album's 16.
    expect(SCREEN).toMatch(/<More color=\{t\.fg\} \/>/);
    expect(read('src/RoundButton.tsx')).toMatch(/⋯/);
    /*
     * And it is the head's `left`, which is the leading corner. The row is
     * `PageHead` now — the same one every tab opens with, with the product's
     * name between the two discs — so the corner is named rather than implied
     * by which child comes first.
     */
    const head = SCREEN.slice(SCREEN.indexOf('<PageHead'), SCREEN.indexOf('styles.headLower'));
    expect(head.indexOf('left={')).toBeGreaterThan(-1);
    expect(head.indexOf('Settings')).toBeGreaterThan(head.indexOf('left={'));
    expect(head.indexOf('Settings')).toBeLessThan(head.indexOf('right={'));
    expect(head.indexOf('New album or group')).toBeGreaterThan(head.indexOf('right={'));
  });

  it('is the only place settings is reached from', () => {
    // It was half of the row under the bio. Two doors to one sheet is one
    // door too many, and the row is worth more to something else.
    expect(SCREEN).not.toMatch(/<Text style=\{\[styles\.actionText[^\]]*\]\}>Settings<\/Text>/);
    expect(SCREEN.match(/setSettings\(true\)/g) ?? []).toHaveLength(1);
  });

  it('draws the `+` as a stroke rather than a labelled button', () => {
    // The third `+` somebody meets in this app; the other two taught it.
    expect(SCREEN).toMatch(/<Glyph name="plus"/);
    expect(SCREEN).toMatch(/accessibilityLabel="New album or group"/);
  });
});

describe('the friends', () => {
  it('keeps the people, not only how many', () => {
    /*
     * `/api/friends` has always answered with the people — the screen threw all
     * but the length away. Keeping them is what lets the count be something to
     * press, and costs no extra request.
     */
    expect(PROFILE).toMatch(/useState<InvitablePerson\[\] \| null>\(null\)/);
    expect(PROFILE).toMatch(/api\.friends\(\)\.catch\(\(\) => null\)/);
    expect(PROFILE).not.toMatch(/\.then\(\(list\) => list\.length\)/);
  });

  it('makes only the friends half of the line a button', () => {
    /*
     * Albums and photographs are already reachable — the shelf below is the
     * albums, and a photograph lives in one. A friend was the one thing this
     * line counted that the app could not then show you.
     */
    expect(SCREEN).toMatch(/onPress=\{friends\?\.length \? \(\) => setShowFriends\(true\) : undefined\}/);
    expect(PROFILE).toMatch(/countsLink: \{ textDecorationLine: 'underline' \}/);
  });

  it('still says "—" rather than "0" before the answer is back', () => {
    // "0 friends" is a claim, and the wrong one to make about somebody whose
    // request is still in flight.
    expect(SCREEN).toMatch(/friends === null \? '—' : friends\.length/);
  });

  it('opens somebody’s own profile, by handle', () => {
    expect(SCREEN).toMatch(/onOpenPerson\(friend\.handle\)/);
    expect(APP).toMatch(/onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
    // And closes the sheet on the way, so there is no list behind the profile.
    expect(SCREEN).toMatch(/setShowFriends\(false\);\s*if \(friend\.handle\)/);
  });

  it('lists somebody with no handle without pretending to be a way through', () => {
    // A profile is reached by handle, and not everybody has chosen one. They
    // are still a friend.
    expect(SCREEN).toMatch(/const reachable = friend\.handle != null/);
    expect(SCREEN).toMatch(/disabled=\{!reachable\}/);
  });
});

describe('the profile details', () => {
  it('sit below the corners rather than under the clock', () => {
    // A 28pt name starting a few pixels below the status bar reads as a title
    // bar; the gap above it is what makes it somebody's name.
    expect(SCREEN).toMatch(/style=\{\[styles\.head, styles\.headLower\]\}/);
    expect(PROFILE).toMatch(/headLower: \{ marginTop: 20 \}/);
  });
});

describe('the page arrives in one piece', () => {
  it('asks for the account and the friend count together', () => {
    /*
     * These were two `await`s in a row, so the screen arrived in three stages:
     * the album grid from an already-loaded prop, then the name and picture a
     * round trip later, then a dash turning into a number a round trip after
     * that. One wave, and both `set`s in the same tick so React batches them
     * into a single render.
     */
    expect(PROFILE).toMatch(/const \[account, friends\] = await Promise\.all\(\[/);
    expect(PROFILE).not.toMatch(/setAccount\(await api\.account\(\)/);
  });

  it('holds the body until there is a body to draw', () => {
    // The corners are exempt: they are the same two glyphs before and after,
    // so holding them back would invent a transition rather than remove one.
    expect(SCREEN).toMatch(/\{account === undefined \? \(/);
    const gate = SCREEN.indexOf('account === undefined ?');
    expect(SCREEN.indexOf('styles.bar')).toBeLessThan(gate);
    expect(SCREEN.indexOf('styles.headLower')).toBeGreaterThan(gate);
    expect(SCREEN.indexOf('styles.grid')).toBeGreaterThan(gate);
  });
});

describe('share profile', () => {
  it('took the half-row settings vacated', () => {
    expect(SCREEN).toMatch(/<Text style=\{\[styles\.actionText, \{ color: t\.fg \}\]\}>Share profile<\/Text>/);
    expect(SCREEN).toMatch(/onPress=\{shareProfile\}/);
  });

  it('hands out the handle, on the address the web already answers', () => {
    expect(SCREEN).toMatch(/Share\.share\(\{ message: `\$\{webBase\}\/u\/\$\{account\.handle\}` \}\)/);
    expect(APP).toMatch(/webBase=\{API_BASE\}/);
  });

  it('is dimmed rather than hidden before there is a handle', () => {
    // A row that changes shape depending on whether you have picked a handle
    // is a row nobody learns.
    expect(SCREEN).toMatch(/disabled=\{!account\.handle\}/);
    expect(SCREEN).toMatch(/if \(!account\?\.handle\) return;/);
  });
});

describe('what the `+` makes', () => {
  it('offers both, and creates neither by itself', () => {
    /*
     * The sheet itself lives in `StartSomething` now, because the Events tab's
     * `+` opens the same two choices — written twice they would be two sheets
     * agreeing today and disagreeing the first time somebody rewrote a line.
     */
    const SHEET = read('src/StartSomething.tsx');
    expect(SHEET).toMatch(/New album/);
    expect(SHEET).toMatch(/New group/);
    expect(SHEET).toMatch(/onAlbum\(\);/);
    expect(SHEET).toMatch(/onGroup\(\);/);
    // And the profile hands it the two destinations rather than drawing it.
    expect(SCREEN).toMatch(/onAlbum=\{onCreateEvent\}/);
    expect(SCREEN).toMatch(/onGroup=\{onCreateGroup\}/);
  });

  it('hands the album off to the photographs, which come first now', () => {
    /*
     * `pick` rather than `create`: making an album begins with choosing the
     * pictures, and the form is the second step. Every entry point goes to the
     * same place, so there is no route into the form without a selection behind
     * it — which is where its window and its cover come from.
     */
    expect(APP).toMatch(/onCreateEvent=\{\(\) => setRoute\(\{ screen: 'pick' \}\)\}/);
    expect(APP).not.toMatch(/setRoute\(\{ screen: 'create' \}\)/);
  });

  it('draws something for somebody without an account', () => {
    /*
     * The button did nothing, and this is why: the gate was written on
     * `create`, which is the second step, and the first step drew only for
     * `signedIn === true`. Nobody signed out could reach the gate, because
     * reaching it meant passing the screen that refused them — so pressing
     * "Create album" set the route to a screen no branch drew. No picker, no
     * gate, no tabs. A blank page with nothing on it and no way back.
     *
     * The gate covers every step now, so the first one answers for the flow —
     * through one predicate rather than a disjunction rewritten at each of its
     * three call sites, which is how the steps came to disagree in the first
     * place.
     */
    expect(APP).toMatch(/making\(route\) && signedIn !== true/);
    expect(APP).toMatch(/route\.screen === 'pick' \|\| route\.screen === 'create'/);
  });

  it('waits rather than accusing somebody who is signed in', () => {
    // `null` is the moment before the account request lands. A gate that
    // flashed there would tell somebody signed in that they are not — so it
    // waits, which is the one thing it must not do silently on a blank page.
    const at = APP.indexOf("signedIn !== true");
    expect(APP.slice(at, at + 600)).toMatch(/signedIn === null \? \(/);
    expect(APP.slice(at, at + 600)).toMatch(/<Waiting size=\{40\} \/>/);
  });

  it('hands the group off through the tab that holds the suggestions', () => {
    /*
     * It still goes by way of the Groups tab rather than opening the page from
     * the profile, and the reason has outlived the form it was written for: the
     * clusters live on that tab, and landing there means somebody who pressed
     * `+` meaning "a group with these people" sees them.
     *
     * The tab no longer unfolds a form; it opens the page, which is the one
     * place a group is made from any entry point.
     */
    expect(APP).toMatch(/setTab\('search'\);\s*setMakeGroup\(\(n\) => n \+ 1\);/);
    expect(APP).toMatch(/openCreate=\{makeGroup\}/);
    expect(EVENTS).toMatch(/if \(openCreate > 0\) onCreateGroup\(\);/);
  });

  it('opens again on a second press', () => {
    // A counter, not a flag: a flag already `true` cannot say "again".
    expect(APP).toMatch(/const \[makeGroup, setMakeGroup\] = useState\(0\)/);
    expect(EVENTS).toMatch(/openCreate\?: number/);
  });

  it('leaves the Groups tab the only place the form is written', () => {
    // One form, not two that drift.
    expect(PROFILE).not.toMatch(/CreateGroupForm/);
  });
});
