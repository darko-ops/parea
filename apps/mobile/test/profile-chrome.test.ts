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
    expect(SCREEN).toMatch(/styles\.bar\b/);
    expect(SCREEN).toMatch(/accessibilityLabel="Settings"/);
    expect(SCREEN).toMatch(/⋯/);
    // And it is the first thing in the bar, which is the left-hand corner.
    const bar = SCREEN.slice(SCREEN.indexOf('styles.bar'), SCREEN.indexOf('styles.headLower'));
    expect(bar.indexOf('Settings')).toBeLessThan(bar.indexOf('New album or group'));
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

describe('the profile details', () => {
  it('sit below the corners rather than under the clock', () => {
    // A 28pt name starting a few pixels below the status bar reads as a title
    // bar; the gap above it is what makes it somebody's name.
    expect(SCREEN).toMatch(/style=\{\[styles\.head, styles\.headLower\]\}/);
    expect(PROFILE).toMatch(/headLower: \{ marginTop: 20 \}/);
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
    expect(SCREEN).toMatch(/New album/);
    expect(SCREEN).toMatch(/New group/);
    expect(SCREEN).toMatch(/onCreateEvent\(\);/);
    expect(SCREEN).toMatch(/onCreateGroup\(\);/);
  });

  it('hands the album off to the screen that already makes one', () => {
    expect(APP).toMatch(/onCreateEvent=\{\(\) => setRoute\(\{ screen: 'create' \}\)\}/);
  });

  it('hands the group off to the tab that holds the suggestions', () => {
    /*
     * The Groups tab's form comes with the people this actor keeps ending up
     * in events with, which is the entire argument for making a group rather
     * than an empty room to fill. A bare name-and-nobody form on the profile
     * would be the problem that tab was written to avoid.
     */
    expect(APP).toMatch(/setTab\('groups'\);\s*setMakeGroup\(\(n\) => n \+ 1\);/);
    expect(APP).toMatch(/openCreate=\{makeGroup\}/);
    expect(EVENTS).toMatch(/if \(openCreate > 0\) setMaking\('anyone'\);/);
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
