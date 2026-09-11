/**
 * Find, after it stopped being three boxes.
 *
 * The tab was a card per kind: "Somebody, by handle", "A group, by name",
 * "Your events, by place" — three bordered panels, two text fields, and a
 * paragraph of policy above each one. So a screen whose whole job is a search
 * asked which of two boxes to type in, and said what could never be searched
 * three times before anything had been searched for at all.
 *
 * One field now, scoped by chips, with the policy said once at the foot. None
 * of the rules under it moved.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');

/** The tab, without the rest of the file. */
const TAB = EVENTS.slice(
  EVENTS.indexOf('export function SearchTab'),
  EVENTS.indexOf('export function AccountCard'),
);

describe('the shape', () => {
  it('found the tab at all', () => {
    expect(TAB).not.toBe('');
  });

  it('is one field and three chips, not three cards', () => {
    expect(TAB).toMatch(/type Scope = 'people' \| 'groups' \| 'places'/);
    expect(TAB).toMatch(/useState<Scope>\('people'\)/);
    // One TextInput on the whole tab.
    expect(TAB.match(/<TextInput/g) ?? []).toHaveLength(1);
    // And not a bordered panel in sight.
    expect(TAB).not.toMatch(/styles\.card/);
  });

  it('keeps what was typed when the scope changes', () => {
    // Which is the whole reason this is one field: switching chips re-runs the
    // same text against the other namespace rather than clearing it.
    expect(TAB).toMatch(/setScope\(id\);\s*\n\s*void search\(query, id\);/);
  });

  it('says the policy once, at the foot', () => {
    /*
     * It used to be above each of three cards, before anything had been
     * searched for — a paragraph in front of an empty screen, and the thing
     * everybody scrolls past. Here it is read by somebody who has just seen
     * what a search returns.
     */
    const foot = TAB.slice(TAB.indexOf('styles.footnote'));
    expect(foot).toMatch(/Events and photos are never\s*\n?\s*searchable/);
    expect(TAB.match(/never\s*\n?\s*searchable|never are/g) ?? []).toHaveLength(1);
  });
});

describe('what did not move', () => {
  it('asks for nothing below the server’s floor', () => {
    // Two characters. Below it there is nothing to ask for, and asking per
    // keystroke is a request per keystroke.
    expect(TAB).toMatch(/next\.trim\(\)\.length < 2/);
  });

  it('empties the list when a lookup fails', () => {
    /*
     * A stale row here is one somebody is about to tap, and tapping it opens a
     * page for a search they have already changed.
     */
    expect(TAB).toMatch(/api\.findPeople\(next\)\.catch\(\(\) => \[\]\)/);
    expect(TAB).toMatch(/api\.searchGroups\(next\)\.catch\(\(\) => \[\]\)/);
  });

  it('keeps Places local, and hands the place to the maps app', () => {
    /*
     * It groups this person's own events and queries nothing, which is why it
     * can answer before two characters. A map view is a native module this
     * codebase cannot test, and handing over the name gets somebody directions
     * as well as a pin.
     */
    expect(TAB).toMatch(/event\.place/);
    expect(TAB).toMatch(/https:\/\/maps\.apple\.com\/\?q=/);
  });

  it('never offers an event or a photograph as something to search for', () => {
    // The one rule on this screen that is the product's rather than the
    // screen's: the only way into an event is being sent it.
    expect(TAB).not.toMatch(/'events'|Scope = [^;]*events/);
  });
});
