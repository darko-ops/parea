/**
 * The Groups tab, and the two rules about it that look like omissions.
 *
 * **There is no Create group button.** `POST /api/groups` requires a
 * `fromEventId` and refuses without one, because a group is something you
 * notice afterwards — the same people kept turning up, so you roll that event
 * into a group. An empty group you then have to fill is a distribution problem
 * with no photographs in it, and the people you would invite have no reason to
 * accept yet. A tab listing groups is exactly where somebody will reasonably
 * add a create button, and the server would then have to grow a way to make
 * one from nothing.
 *
 * **A group never shows a photograph.** It has no cover of its own, and the
 * only pictures available are inside events that belong to it — putting one on
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
  const tab = EVENTS.slice(
    EVENTS.indexOf('export function GroupsTab'),
    EVENTS.indexOf('export function SearchTab'),
  );

  it('found the tab at all', () => {
    // Every assertion below is over this slice, and a rename upstream would
    // empty it and pass all of them silently.
    expect(tab).not.toBe('');
  });

  it('offers to create a group, beside the people it would be made with', () => {
    /*
     * This assertion used to be the opposite — no create action, because a
     * group is made from an event. What reversed it is the clusters: creation
     * is offered next to the people it would gather, so it cannot produce the
     * empty room the old rule existed to prevent.
     *
     * What survives is the *pairing*. A create control on this screen without
     * the clusters beside it is the thing that was refused, so the guard is
     * that the screen reads them.
     */
    expect(tab).toMatch(/New group/);
    expect(tab).toMatch(/api\.clusters\(\)/);
    expect(tab).toMatch(/<ClusterCard/);
  });

  it('still makes no request of its own to create one', () => {
    // The call lives in `CreateGroup.tsx` behind the Create button, where
    // `create-group.test.ts` pins it to exactly one. The tab holds which card
    // is open and nothing else.
    expect(tab).not.toMatch(/method: 'POST'/);
  });

  it('says where groups come from when there is nothing to recognise', () => {
    expect(EVENTS).toMatch(/You are not in any groups yet/);
    expect(EVENTS).toMatch(/Groups are for the people who keep turning up/);
  });

  it('draws a group as a letter, never a photograph', () => {
    /*
     * The rule is about *the door*: a group has no picture of its own, and the
     * only ones available are inside events that belong to it, so borrowing
     * one shows a photograph from a room on the screen that is merely the way
     * in — including to somebody who has since been removed.
     *
     * Cluster cards do draw faces, and that is not an exception to this: an
     * avatar is a person's own picture, not a photograph out of somebody's
     * evening. They live in `CreateGroup.tsx`, which is why the slice below
     * stays clean — asserted here so that stays a reason rather than a
     * coincidence that a later move would quietly undo.
     */
    const rows = tab.slice(tab.indexOf('groups.map('));
    expect(rows).toMatch(/groupTile/);
    // Never anything out of an event: no mosaic, no cover, no event thumb.
    expect(rows).not.toMatch(/mosaic|coverUrl|event\.cover/);
    /*
     * The rows draw member faces now, which is the same exception the cluster
     * cards have always had and for the same reason — so the check moves from
     * "no image at all" to "every image is a person's own picture". Written as
     * every `uri:` in the slice, so a photograph smuggled in under any other
     * field fails here rather than passing because it was not called `cover`.
     */
    const sources = [...rows.matchAll(/uri:\s*([A-Za-z.]+)/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(['person.avatarUrl']));
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
