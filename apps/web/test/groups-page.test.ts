/**
 * Groups has a page, and two rules about it that look like omissions.
 *
 * **There is no Create group button.** `POST /api/groups` requires a
 * `fromEventId` and refuses without one, because a group is something you
 * notice afterwards — the same people kept turning up, so you roll that album
 * into a group. An empty group you then have to fill is a distribution problem
 * with no photographs in it, and the people you would invite have no reason to
 * accept yet. A page listing groups is exactly where somebody will reasonably
 * add a create button, and the API would then have to grow a way to make one
 * from nothing. So the absence is asserted.
 *
 * **A group never shows a photograph.** It has no cover of its own, and the
 * only pictures available are inside albums that belong to it — putting one on
 * the door means a photograph from a room appears on the screen that is merely
 * the way into it, including for somebody who has since been removed. The tile
 * is a letter in a lens colour, as it is on the search page.
 *
 * Source checks because there is no DOM in this suite; they stand in for the
 * browser run that confirmed the page against real groups.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const read = async (path: string) =>
  stripComments(await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const PAGE = await read('../app/groups/page.tsx');
const RAIL = await read('../app/components/Rail.tsx');
const API = await read('../app/api/groups/route.ts');

describe('where a group comes from', () => {
  it('is still an album, enforced by the endpoint', () => {
    // The rule this page is shaped around. If this ever stops being true the
    // page's empty state is telling people something false.
    expect(API).toMatch(/fromEventId/);
    expect(API).toMatch(/event_required/);
  });

  it('is not offered as a button on the page', () => {
    /*
     * No create form, and no POST to the groups endpoint. The page says where
     * groups come from and sends somebody to their albums, which is the only
     * place the action can be taken.
     */
    expect(PAGE).not.toMatch(/method: 'POST'|fetch\(/);
    // "Make a group" does appear, as the name of the control to look for on
    // an album — the sentence pointing somewhere else, not a control here.
    expect(PAGE).not.toMatch(/Create group|New group/);
    expect(PAGE).not.toMatch(/<button/);
  });

  it('tells somebody with none where to go', () => {
    // An empty list with nothing said is a page that looks broken to the
    // person most likely to be new.
    expect(PAGE).toMatch(/You are not in any groups yet/);
    expect(PAGE).toMatch(/Make a group/);
    expect(PAGE).toMatch(/href="\/albums"/);
  });
});

describe('what a row shows', () => {
  it('draws a letter, never a photograph', () => {
    // No `Face`, no `imageSrc`, no `<img>`: there is nothing to draw that
    // would not be a picture out of a room this page is only the door to.
    expect(PAGE).not.toMatch(/<img|imageSrc|avatarUrl|<Face/);
    expect(PAGE).toMatch(/group-tile/);
  });

  it('says the role only when it is one', () => {
    // "Member" on every other row is a word that appears so often it stops
    // being read, on the rows where it changes nothing.
    expect(PAGE).toMatch(/role === 'admin'/);
  });

  it('words its times on the server', () => {
    // Two clocks disagree, and React answers a text mismatch by throwing the
    // tree away — the same rule every other relative time here follows.
    expect(PAGE).toMatch(/function ago/);
    expect(PAGE).toMatch(/RelativeTimeFormat/);
  });
});

describe('the rail', () => {
  it('puts Groups above Search', () => {
    /*
     * Order is the argument. Home and Activity are what has already happened
     * to you; Groups is the rooms you are already in; Search is the only row
     * that goes looking for something you are not part of yet. Below Search
     * would file the places you belong under the heading for finding places
     * you do not.
     */
    const groups = RAIL.indexOf("label: 'Groups'");
    const search = RAIL.indexOf("label: 'Search'");
    const activity = RAIL.indexOf("label: 'Activity'");
    expect(groups).toBeGreaterThan(-1);
    expect(activity).toBeLessThan(groups);
    expect(groups).toBeLessThan(search);
  });

  it('does not wear the logo as a nav glyph', async () => {
    // Three overlapping circles is the mark. A row drawn with it reads as "go
    // to Parea" rather than as a section, and the rail already has the mark at
    // the top of it.
    const icons = await read('../app/components/RailIcon.tsx');
    const groups = icons.slice(icons.indexOf("glyph === 'groups'"), icons.indexOf("glyph === 'search'"));
    expect(groups).not.toBe('');
    expect((groups.match(/<circle/g) ?? []).length).toBeLessThan(3);
  });
});
