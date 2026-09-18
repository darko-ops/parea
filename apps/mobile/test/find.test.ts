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

/** Copy with its line wrapping taken out — Prettier breaks JSX text nodes
    wherever the column runs out, which changes nothing anybody reads. */
const flat = (source: string) => source.replace(/\s+/g, ' ');

/** The tab, without the rest of the file. */
const TAB = EVENTS.slice(
  EVENTS.indexOf('export function SearchTab'),
  EVENTS.indexOf('export function AccountCard'),
);

describe('the shape', () => {
  it('found the tab at all', () => {
    expect(TAB).not.toBe('');
  });

  it('is one field and four chips, not four cards', () => {
    /*
     * `all` is the default and is newer than the other three. The chips used
     * to decide only which namespace a query went to, so an untouched Find was
     * a field, three chips and nothing else — a screen that answers questions
     * and volunteers nothing, on the tab somebody opens when they do not yet
     * know what they are looking for.
     */
    expect(TAB).toMatch(/type Scope = 'all' \| 'people' \| 'groups' \| 'places'/);
    expect(TAB).toMatch(/useState<Scope>\('all'\)/);
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
    // "Albums", not "Events": the schema's word in a sentence a person reads,
    // which is the half of that rule `wordmark.test.ts` was only checking in
    // quoted strings.
    expect(foot).toMatch(/Albums and photos are never\s*\n?\s*searchable/);
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

/**
 * What Find shows before anybody types.
 *
 * It showed nothing. A field, three chips and an empty page — a screen that
 * answers questions and volunteers none, on the tab somebody opens precisely
 * when they do not yet know what they are looking for.
 *
 * So the chips gained an `all`, which is the default, and they now decide the
 * resting page as well as which namespace a query goes to. All is both halves;
 * the other two are each half on its own, which is what a filter is for.
 */
describe('the page before a question', () => {
  it('leads with people and follows with groups', () => {
    /*
     * Suggestions above the rooms. They are the only thing on this page that
     * is a *recommendation* rather than something already yours, and somebody
     * opening Find with nothing in mind is who they are for — a list of rooms
     * they are already in answers nothing for that person.
     */
    const people = TAB.indexOf('PEOPLE YOU MAY KNOW');
    const groups = TAB.indexOf('YOUR GROUPS');
    expect(people).toBeGreaterThan(-1);
    expect(groups).toBeGreaterThan(people);
  });

  it('shows each half under its own filter, and both under All', () => {
    expect(TAB).toMatch(/\{!asked && \(scope === 'all' \|\| scope === 'people'\) && suggested !== null/);
    expect(TAB).toMatch(/\{!asked && scope !== 'places' && scope !== 'people' && mine !== null/);
  });

  it('searches both namespaces under All', () => {
    // One field, two namespaces, rather than making somebody guess which chip
    // the thing they half-remember is filed under.
    expect(TAB).toMatch(/if \(into === 'people' \|\| into === 'all'\)/);
    expect(TAB).toMatch(/if \(into === 'groups' \|\| into === 'all'\)/);
    expect(TAB).toMatch(/\(scope === 'people' \|\| scope === 'all'\) &&/);
    expect(TAB).toMatch(/\(scope === 'groups' \|\| scope === 'all'\) &&/);
    // And one sentence when both come back empty. Two lines under a box that
    // asked both questions is the page reporting its own internals.
    expect(TAB).toMatch(/scope === 'all' && asked && people\.length === 0 && groups\.length === 0/);
  });
});

/**
 * People you may know: friends of your friends, sideways.
 */
describe('the suggestions row', () => {
  it('scrolls across, and bleeds past the page margin', () => {
    /*
     * A card half off the right edge is what tells somebody there is more of
     * it sideways. A row that stops neatly at the margin reads as a row that
     * has ended — so the row cancels the page's padding with a negative margin
     * and puts it back as content padding.
     */
    expect(TAB).toMatch(/horizontal\s*\n\s*showsHorizontalScrollIndicator=\{false\}/);
    expect(EVENTS).toMatch(/suggestBleed: \{ marginHorizontal: -20 \}/);
    expect(EVENTS).toMatch(/suggestRow: \{ paddingHorizontal: 20, gap: 10 \}/);
    expect(EVENTS).toMatch(/scroll: \{ padding: 20,/);
  });

  it('says why each person is there', () => {
    // Without it this is a row of strangers, and a row of strangers on a page
    // about the people you know is the thing nobody taps.
    expect(TAB).toMatch(/plural\(person\.mutuals, 'mutual'\)/);
    expect(TAB).toMatch(/plural\(person\.mutuals, 'mutual friend'\)/);
  });

  it('asks without reloading the row', () => {
    /*
     * The server answers a request with the standing it produced, so the
     * button can change on the spot. Re-fetching the suggestions to make a row
     * disappear would take the whole list out from under a finger mid-scroll,
     * which is the thing a horizontal row is least able to survive.
     */
    expect(TAB).toMatch(/await api\.askFriend\(actorId\)/);
    expect(TAB).toMatch(/setSent\(\(was\) => \(\{ \.\.\.was, \[actorId\]: 'asked' \}\)\)/);
    expect(TAB).not.toMatch(/askFriend[\s\S]{0,200}loadMine\(\)/);
  });

  it('puts the button back when the ask fails', () => {
    // Rather than a row stuck saying it is doing something it has stopped
    // doing.
    expect(TAB).toMatch(/delete next\[actorId\];/);
  });

  it('says so when there is nobody to suggest', () => {
    // Arithmetic rather than anything being wrong: suggestions are friends of
    // friends, so somebody with no friends has none. The box above is the way
    // out of that, which is what the sentence points at.
    expect(TAB).toMatch(/scope === 'people' && suggested !== null && suggested\.length === 0/);
    expect(flat(TAB)).toMatch(/Nobody to suggest yet/);
  });
});

/**
 * The line at the foot, which is the only place this page states its limits.
 */
describe('what the page says it can reach', () => {
  it('names all three of the things its chips offer', () => {
    /*
     * It named two. Places was missing, and it is the one somebody is most
     * likely to assume works like the other two — it does not: a place here is
     * read off the albums this person can already open, never off anybody
     * else's, so it is the one search on the page that asks the server nothing
     * at all.
     */
    const foot = flat(TAB.slice(TAB.indexOf('styles.footnote')));
    expect(foot).toMatch(/Handles/);
    expect(foot).toMatch(/findable groups/);
    expect(foot).toMatch(/places off your own albums/);
  });

  it('still says the thing it was written to say', () => {
    // The limit that matters most, and the reason the page exists in the shape
    // it does: nothing gets anybody into an album except being sent it.
    const foot = flat(TAB.slice(TAB.indexOf('styles.footnote')));
    expect(foot).toMatch(/Albums and photos are never searchable/);
    expect(foot).toMatch(/the only way into one is being sent it/);
  });
});

