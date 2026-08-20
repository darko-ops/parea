/**
 * The Groups tab, and the two rules about it that look like omissions.
 *
 * **There is no Create group button.** `POST /api/groups` requires a
 * `fromEventId` and refuses without one, because a group is something you
 * notice afterwards — the same people kept turning up, so you roll that album
 * into a group. An empty group you then have to fill is a distribution problem
 * with no photographs in it, and the people you would invite have no reason to
 * accept yet. A tab listing groups is exactly where somebody will reasonably
 * add a create button, and the server would then have to grow a way to make
 * one from nothing.
 *
 * **A group never shows a photograph.** It has no cover of its own, and the
 * only pictures available are inside albums that belong to it — putting one on
 * the door means a photograph from a room appears on the screen that is merely
 * the way into it. The tile is a letter in a lens colour, as on the web.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run, and they catch the screen being quietly taken apart.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const EVENTS = read('src/Events.tsx');
const API = read('src/api.ts');

describe('the tab', () => {
  it('sits between Events and Find', () => {
    /*
     * Order is the argument, and the same one the web rail makes: Events is
     * what has already happened, Groups is the rooms you are already in, and
     * Find is the only tab that goes looking for something you are not part of
     * yet. After Find would file the places you belong under the heading for
     * finding places you do not.
     */
    const events = APP.indexOf("['home', 'Events']");
    const groups = APP.indexOf("['groups', 'Groups']");
    const find = APP.indexOf("['search', 'Find']");
    expect(groups).toBeGreaterThan(-1);
    expect(events).toBeLessThan(groups);
    expect(groups).toBeLessThan(find);
  });

  it('is one of the four the Tab type allows', () => {
    // A tab bar entry with no matching branch renders an empty screen, which
    // typechecking would catch — this catches the reverse, a branch nobody can
    // reach because the bar never offers it.
    expect(APP).toMatch(/type Tab = 'home' \| 'groups' \| 'search' \| 'profile'/);
    expect(APP).toMatch(/tab === 'groups'/);
  });

  it('does not leave a second copy of the list inside You', () => {
    // It was a card under the name field — the drawer version of the thing the
    // product treats as persistent identity, and now one tap from a tab that
    // holds the same rooms.
    const profile = EVENTS.slice(EVENTS.indexOf('export function ProfileTab'));
    expect(profile).not.toMatch(/groups\.map\(/);
  });
});

describe('what the screen may do', () => {
  it('does not offer to create a group', () => {
    const tab = EVENTS.slice(
      EVENTS.indexOf('export function GroupsTab'),
      EVENTS.indexOf('export function SearchTab'),
    );
    expect(tab).not.toBe('');
    expect(tab).not.toMatch(/Create group|New group/);
    // No POST of any kind: the only writes a group screen could make are
    // joining and creating, and neither belongs on a list of rooms you are in.
    expect(tab).not.toMatch(/method: 'POST'/);
  });

  it('says where groups come from instead', () => {
    expect(EVENTS).toMatch(/You are not in any groups yet/);
    expect(EVENTS).toMatch(/A group is made from an album, not from nothing/);
  });

  it('draws a letter, never a photograph', () => {
    const tab = EVENTS.slice(
      EVENTS.indexOf('export function GroupsTab'),
      EVENTS.indexOf('export function SearchTab'),
    );
    expect(tab).not.toMatch(/<Image|mosaic|uri:/);
    expect(tab).toMatch(/groupTile/);
  });
});

describe('what it costs at launch', () => {
  it('keeps the detailed shape off the startup request', () => {
    /*
     * `myGroups` is called on every launch — before anybody has opened this
     * tab, and possibly before they are in any groups at all. The counts are
     * three aggregates per row, so they are a second call the tab makes for
     * itself rather than weight on the one the app already makes.
     */
    expect(API).toMatch(/myGroupsDetailed/);
    expect(API).toMatch(/'\/api\/groups\?detail=1'/);
    // And the plain one still asks for the plain thing.
    const plain = API.slice(API.indexOf('async myGroups('), API.indexOf('myGroupsDetailed'));
    expect(plain).toContain("'/api/groups'");
    expect(plain).not.toContain('detail=1');
  });
});
