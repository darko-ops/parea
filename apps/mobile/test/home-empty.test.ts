/**
 * Albums with nothing in them are not on the home page.
 *
 * An empty album is a card that asks to be opened and then has nothing to
 * show, and most of them were never this person's doing: somebody made an
 * evening, added people, and the evening has not happened yet. A column of
 * those was the first thing the product's main screen said, on the tab whose
 * whole subject is photographs.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const APP = read('App.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = code(
  EVENTS.slice(EVENTS.indexOf('export function HomeTab'), EVENTS.indexOf('export function GroupsTab')),
);

describe('the home list', () => {
  it('leaves out the ones with no photographs', () => {
    expect(HOME).toMatch(
      /const filled = events\.filter\(\s*\(event\) => event\.photoCount > 0 \|\| event\.arrivingCount > 0,\s*\);/,
    );
  });

  it('counts what is still being processed as full', () => {
    /*
     * Without `arrivingCount`, adding the first photograph to an album makes
     * it vanish for the minute or so the derivatives take and then come back —
     * which is worse than either state on its own.
     */
    expect(HOME).toMatch(/event\.arrivingCount > 0/);
  });

  it('draws the filtered list, not the whole one', () => {
    // Including the empty state and the spinner: "you have nothing" has to
    // mean the same thing as what the list below it is showing.
    expect(HOME).toMatch(/\{filled\.map\(\(event\) => \(/);
    expect(HOME).toMatch(/\{loading && filled\.length === 0 &&/);
    expect(HOME).toMatch(/\{!loading && filled\.length === 0 && \(/);
    expect(HOME).not.toMatch(/\{events\.map\(/);
  });

  it('is the home tab only', () => {
    /*
     * The groups tab reads the same `events` for the three covers under each
     * group's name, and a group whose evenings have not happened yet should
     * still be a room you can walk into.
     */
    const GROUPS = code(
      EVENTS.slice(EVENTS.indexOf('export function GroupsTab'), EVENTS.indexOf('function GroupBlock')),
    );
    expect(GROUPS).not.toMatch(/photoCount > 0/);
  });

  it('still lands you inside an album you have just made', () => {
    /*
     * This hides your own empty albums too, so the create flow must not depend
     * on the list: `onCreated` opens the event rather than returning to it.
     */
    expect(APP).toMatch(/onCreated=\{\(created\) => \{[\s\S]{0,200}void open\(\{/);
  });
});
