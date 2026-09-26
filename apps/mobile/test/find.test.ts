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

  it('carries no policy paragraph at all', () => {
    /*
     * There was a footnote at the foot — "Handles and findable groups only,
     * and places off your own albums. Albums and photos are never searchable
     * — the only way into one is being sent it." — and it is gone by request.
     *
     * Worth naming what went with it, because the sentence was load-bearing
     * once: it was the only place in the app that said albums are not
     * searchable. That rule is still true and still enforced server-side; it
     * is simply no longer stated here. If it needs saying again it belongs
     * somewhere somebody is asking the question, not under every search.
     */
    expect(TAB).not.toMatch(/styles\.footnote/);
    expect(TAB).not.toMatch(/never\s*\n?\s*searchable/);
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
 * What the page tells you about its own reach, now that the line at the foot
 * is gone.
 */
describe('what the page says it can reach', () => {
  it('says it by answering, not by explaining in advance', () => {
    /*
     * The three sentences that used to describe the page's reach are gone —
     * see `carries no policy paragraph at all`. What is left is the answers
     * themselves, which say the same thing at the moment it means something:
     * a handle that matches nothing says so, and so does a group.
     */
    expect(TAB).toMatch(/No handle starts with that\./);
    expect(TAB).toMatch(/Nothing findable by that name\./);
  });
});

/**
 * The last few things somebody looked for, and the ask beside a stranger.
 */
describe('what the box remembers', () => {
  const PLATFORM = read('src/platform.ts');

  it('keeps ten on this phone and sends none of them anywhere', () => {
    /*
     * A search term is a sentence about who somebody was looking for, and this
     * product keeps none: no table, no request, no field. The list is held by
     * the device that typed it.
     */
    expect(PLATFORM).toMatch(/export const RECENT_SEARCHES = 10;/);
    expect(PLATFORM).toMatch(/SecureStore\.setItemAsync\(SEARCHES_KEY/);
    expect(TAB).not.toMatch(/api\.[a-zA-Z]*[Ss]earch[a-zA-Z]*\([^)]*recent/);
  });

  it('is handed back with the phone', () => {
    // Not a credential like the token and the link tokens beside it, which is
    // why it is last in that function rather than first — but it is still the
    // last person's, and they are gone.
    expect(PLATFORM).toMatch(
      /signOutDevice[\s\S]{0,600}deleteItemAsync\(SEARCHES_KEY\)/,
    );
  });

  it('remembers a search rather than a keystroke', () => {
    /*
     * The box asks after two characters and on every keystroke after that, so
     * a list of what was asked would be "w", "wr", "wre". What means "this was
     * the search" is opening one of its answers.
     */
    expect(TAB).toMatch(/remember\(query\);\s*onOpenPerson\(person\.handle\)/);
    expect(TAB).toMatch(/remember\(query\);\s*onOpenGroup\(group\.id\)/);
    expect(TAB).toMatch(/if \(term\.trim\(\)\.length < 2\) return;/);
  });

  it('keeps one of a term however it was capitalised', () => {
    // "Wren" and "wren" are the same search; the one to keep is the one last
    // written.
    expect(PLATFORM).toMatch(/t\.toLowerCase\(\) !== kept\.toLowerCase\(\)/);
  });

  it('shows it only while nothing is typed, and offers to forget it', () => {
    expect(TAB).toMatch(/\{!asked && recent\.length > 0 && \(/);
    expect(TAB).toMatch(/onPress=\{forgetAll\}/);
  });
});

describe('asking somebody from a result', () => {
  it('offers it to a stranger and says the rest in words', () => {
    /*
     * Being findable leads to being asked and to nothing else — so the ask is
     * on the row where somebody was found rather than two screens away.
     *
     * "Requested" and "Asked you" are words, not controls: withdrawing is
     * somebody's own to do and answering wants Decline beside it, and both of
     * those live on the profile, which is one press away.
     */
    expect(TAB).toMatch(/standing === 'none' \? \(/);
    expect(TAB).toMatch(/>Add</);
    expect(TAB).toMatch(/standing === 'asked' \? \([\s\S]{0,120}Requested/);
    expect(TAB).toMatch(/standing === 'asking' \? \([\s\S]{0,120}Asked you/);
  });

  it('makes the same ask the profile and the suggestions make', () => {
    // One call, so three surfaces cannot come to disagree about what asking
    // does — including the crossed case the endpoint answers for all of them.
    expect(TAB).toMatch(/onPress=\{\(\) => void ask\(person\.actorId\)\}/);
    expect(TAB).toMatch(/api\.askFriend\(actorId\)/);
  });

  it('lets what this screen just did outrank what the server last said', () => {
    /*
     * Results are refetched on the next keystroke, and the standing in them is
     * as old as the request. A row that reverted to "Add" mid-flight would be
     * offering to do a thing that is already done.
     */
    expect(TAB).toMatch(
      /const standing = sent\[person\.actorId\] \? 'asked' : \(person\.standing \?\? 'none'\);/,
    );
  });

  it('knows where the two of you stand before anybody presses', () => {
    const API = read('src/api.ts');
    expect(API).toMatch(/standing\?: Standing;/);
  });
});
