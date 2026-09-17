/**
 * The groups, and the two rules about them that look like omissions.
 *
 * They had a tab of their own until recently, above the conversations going on
 * inside them. They are a section of Find now — the page whose whole subject is
 * locating a room, showing the ones you are in above a field for the ones you
 * are not — and the tab they used to share is the conversations alone. So the
 * slice these assertions run over is `SearchTab`, and everything they were
 * protecting is unchanged by the move.
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
     * Order is the argument, and the same one the web rail makes: Albums is
     * what has already happened, Groups is the rooms you are already in, and
     * Find is the only tab that goes looking for something you are not part of
     * yet. After Find would file the places you belong under the heading for
     * finding places you do not.
     */
    // The bar carries a glyph between the tab and its label now — the label
    // survives as the accessibility name, which is what these look for.
    const events = APP.indexOf("['home', 'photos', 'Albums']");
    const chats = APP.indexOf("['chats', 'group', 'Chats']");
    const find = APP.indexOf("['search', 'search', 'Find']");
    expect(chats).toBeGreaterThan(-1);
    expect(events).toBeLessThan(chats);
    expect(chats).toBeLessThan(find);
  });

  it('is one of the four the Tab type allows', () => {
    // A tab bar entry with no matching branch renders an empty screen, which
    // typechecking would catch — this catches the reverse, a branch nobody can
    // reach because the bar never offers it.
    expect(APP).toMatch(/type Tab = 'home' \| 'chats' \| 'search' \| 'profile'/);
    expect(APP).toMatch(/tab === 'chats'/);
  });

  it('does not leave a second copy of the list inside You', () => {
    // It was a card under the name field — the drawer version of the thing the
    // product treats as persistent identity, and now one tap from a tab that
    // holds the same rooms.
    const profile = EVENTS.slice(EVENTS.indexOf('export function ProfileTab'));
    expect(profile).not.toMatch(/groups\.map\(/);
  });
});

/**
 * A slice that refuses to be empty.
 *
 * `indexOf` answers -1 for a name that has been renamed, and `slice(-1, n)`
 * then reads something other than the thing under test — quietly, and every
 * assertion over it passes. That has happened twice in this suite.
 */
/**
 * Source with its line wrapping taken out.
 *
 * Almost every sentence a person reads in this app is a JSX text node, and
 * Prettier breaks those wherever the column runs out — so a regex for a phrase
 * fails on the copy being *reflowed*, which changes nothing anybody sees. Two
 * assertions in this suite have been fixed by hand for exactly that.
 */
const flat = (source: string) => source.replace(/\s+/g, ' ');

function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  if (start < 0) throw new Error(`no ${from}`);
  if (end < 0) throw new Error(`no ${to} after ${from}`);
  return source.slice(start, end);
}

describe('what the screen may do', () => {
  // Find, which is where the groups live. See the note at the top.
  const tab = between(EVENTS, 'export function SearchTab', 'function Result(');

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
    expect(tab).toMatch(/<StartSomething/);
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
    expect(flat(EVENTS)).toMatch(/You are not in any groups yet/);
    expect(flat(EVENTS)).toMatch(/Groups are for the people who keep turning up/);
  });

  it('draws the door as a letter, never as a photograph', () => {
    /*
     * The rule is about *the door*, and it still holds: the tile beside a
     * group's name is a letter on the lens colour its id hashes to, and
     * nothing about a group is ever drawn from a picture.
     */
    const block = between(EVENTS, 'function GroupBlock', 'const COVER_STRIP');
    expect(block).toMatch(/groupTile/);
    expect(block).toMatch(/lensFor\(group\.id\)/);
  });

  it('takes the covers under a group off this viewer’s own albums', () => {
    /*
     * The tab shows photographs now — three recent covers under each group's
     * name — which is a real change to a rule this file used to state as "no
     * image at all that is not a person's own picture".
     *
     * What replaces it is a bound on *where the picture comes from*, which is
     * what the old rule was protecting. The old worry was a group handing out
     * a photograph from a room to somebody merely standing at the door,
     * "including to somebody who has since been removed". These covers are
     * read off `events` — the albums this actor can already open, the same
     * list the home tab draws — and never off the group or its detail
     * response. Somebody who was never in one of a group's events, or who has
     * since been removed from it, has no listing for it and so contributes no
     * tile at all — the strip is only as wide as the covers it has, and a group
     * with none draws no strip. The server is not asked for a group's
     * photographs and does not answer with any.
     *
     * So: every `uri:` in the block is either a cover from this viewer's own
     * album list, or a person's own avatar. A photograph reaching this screen
     * under any other name fails here.
     */
    const block = between(EVENTS, 'function GroupBlock', 'const COVER_STRIP');
    // `!` allowed in the path: the tiles are filtered on `album.cover` before
    // they are drawn, so the assertion inside the map is not a second check.
    const sources = [...block.matchAll(/uri:\s*([A-Za-z.?!]+)/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(['album.cover!.src']));

    /*
     * And no room reserved for a cover that does not exist.
     *
     * Three slots were drawn whatever the group held, the gaps filled with
     * dashed outlines — so one evening was a photograph and two empty boxes,
     * and none was 84 points of nothing. A placeholder belongs where somebody
     * is meant to put something, and nobody puts an album into a strip.
     */
    expect(block).toMatch(/albums\.filter\(\(album\) => album\.cover\)/);
    expect(block).toMatch(/\{withCovers\.length > 0 && \(/);
    expect(EVENTS).not.toMatch(/stripEmpty/);

    // And the albums are handed in, not fetched: the tab cannot reach for a
    // group's photographs because it never asks anybody for any.
    expect(tab).toMatch(/events: EventListing\[\]/);
    expect(tab).not.toMatch(/mosaic|coverUrl/);
    expect(APP).toMatch(/<SearchTab[\s\S]{0,400}events=\{events\}/);
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

/**
 * The room itself, which was a list of blue words.
 *
 * Opening a group showed its name, a member count, and a card containing each
 * album's name as a link with a raw date beside it — a directory, in a product
 * whose subject is photographs, describing the one place a group's photographs
 * accumulate.
 *
 * The server could already answer this properly. The web's group page has been
 * drawing covers, counts and month headings out of `groupArchive` for a while;
 * it calls that function directly, being a server component, and the route the
 * app asks was still returning four bare columns from `groupEvents`.
 */
describe('what a group shows when you open it', () => {
  const GROUPS = read('src/Groups.tsx');
  const ROUTE = readFileSync(
    fileURLToPath(new URL('../../web/app/api/groups/[id]/route.ts', import.meta.url).href),
    'utf8',
  );

  it('answers with the archive the web page already draws', () => {
    expect(ROUTE).toMatch(/groupArchive\(db, group\.id, actorId, since\)/);
    expect(ROUTE).toMatch(/groupPeople\(db, group\.id\)/);
    expect(ROUTE).not.toMatch(/groupEvents\(/);
    /*
     * Null `since` means never looked, which has to mean everything is new
     * rather than nothing: the epoch, not `now`. The same rule the web page
     * follows, and getting it backwards would silently mark a whole group read.
     */
    expect(ROUTE).toMatch(/invitesSeenAtFor\(db, actorId\)\) \?\? new Date\(0\)/);
  });

  it('carries what opening an album needs, not only what drawing one does', () => {
    /*
     * The web navigates to a route by id. The native client cannot: opening an
     * album means handing the screen a summary, and the album then presents a
     * credential and asks the library for the photographs taken while the
     * evening was on. Without the window it falls through to the system picker
     * for every album reached through a group — which is most of them once a
     * group exists, and the reason it would is invisible.
     */
    const SERVER = readFileSync(
      fileURLToPath(new URL('../../web/src/groups.ts', import.meta.url).href),
      'utf8',
    );
    expect(SERVER).toMatch(/linkToken: schema\.events\.linkToken,\s*\n\s*startsAt: schema\.events\.startsAt,/);
    expect(GROUPS).toMatch(/startsAt: album\.startsAt,/);
  });

  it('leads with the newest album and shelves the rest', () => {
    /*
     * Every album used to be a full-width cover, which is a feed: thirty-four
     * of them is thirty-four screens, and an archive is a thing you look
     * *back* through.
     *
     * So the newest is a cover at the size of the thing it is — a room that
     * meets every Tuesday is opened to find out what happened last Tuesday —
     * and everything behind it is a thumbnail and two lines, which is as much
     * as an album from March needs to be found by.
     */
    expect(GROUPS).toMatch(/function Feature\(/);
    expect(GROUPS).toMatch(/function Row\(/);
    expect(GROUPS).toMatch(/const \[newest, \.\.\.rest\] = events;/);
    // Full-bleed and at the cover's own 4:5, which the shelf's thumbnail keeps.
    expect(GROUPS).toMatch(/feature: \{ aspectRatio: 4 \/ 5, marginHorizontal: -20/);
    expect(GROUPS).toMatch(/thumb: \{ width: 76, height: 95, flex: 0 \}/);
    // And what is in it, which the old row could not say at all.
    expect(GROUPS).toMatch(/'Nothing in it yet'/);
  });

  it('groups this year by month and older years by year', () => {
    /*
     * Contiguous runs rather than a map keyed by month: the list arrives
     * newest-first so a month's albums are already together, and a map would
     * quietly reorder them if that ever stopped being true. This draws the
     * same heading twice instead, which is visibly wrong rather than silently
     * rearranged.
     *
     * A year gets one heading rather than its twelve months, because twelve
     * headings for a year nobody is scrolling to is a year that takes twelve
     * screens to pass. The rows under one carry the month in their own date
     * line, which is all the headings were saying.
     */
    expect(GROUPS).toMatch(/if \(last && last\.label === label\) last\.events\.push\(album\)/);
    expect(GROUPS).toMatch(/if \(year !== thisYear\) \{/);
    expect(GROUPS).toMatch(/withMonth\b/);
    // One rule component for both, so a month and a year cannot drift apart.
    expect(GROUPS).toMatch(/function Rule\(/);
    expect(GROUPS).toMatch(/loud \? t\.fg : t\.dim/);
  });

  it('shows who is in the room, as one stack rather than a row', () => {
    /*
     * It was a horizontal scroll of faces with first names under them, which
     * is a directory: to read it you scroll it, and it takes the full width to
     * say what a stack says in a third of it. Overlapped, the faces are one
     * object — a group of people rather than a list of them — and the width it
     * gives back is what carries the sentence beside it.
     */
    expect(GROUPS).toMatch(/stack: \{ flexDirection: 'row', flex: 0 \}/);
    expect(GROUPS).toMatch(/stacked: \{ marginLeft: -8 \}/);
    expect(GROUPS).toMatch(/group\.people\.slice\(0, FACES\)/);
    /*
     * The one fact about a room that a count of heads does not give: whether
     * everybody turns up, or there is a core and a fringe. It falls back to
     * the count where there is no archive to have attended — the server
     * answers null rather than saying eleven of you have been to all nought
     * of the albums.
     */
    expect(GROUPS).toMatch(/of you have been to every one/);
    expect(GROUPS).toMatch(/group\.everyAlbum !== null && group\.everyAlbum > 1/);
    const SERVER = readFileSync(
      fileURLToPath(new URL('../../web/src/groups.ts', import.meta.url).href),
      'utf8',
    );
    expect(SERVER).toMatch(/export async function attendedEvery/);
    /*
     * What that function *does* with an empty archive is the web suite's, in
     * `groups.test.ts`, against a real database. This asserted the expression
     * character for character and broke the moment the number was coerced —
     * a screen test failing over the shape of somebody else's null check
     * tests nothing about the screen.
     */
    /*
     * Rounded squares, like every other face in this product. The overlapping
     * circles over an album's cover stay the exception: that row reads as a
     * crowd because circles overlap cleanly, and it has no words beside it to
     * line up with.
     */
    expect(GROUPS).toMatch(/stackFace: \{ width: 30, height: 30, borderRadius: 8/);
    // Pressable as one thing, into the list you read rather than glance at.
    expect(GROUPS).toMatch(/function Everyone\(/);
  });

  it('puts leaving behind the same glyph an album’s settings sit behind', () => {
    /*
     * It was a red button at the foot of the archive, which put the screen's
     * one irreversible action at the end of the one list somebody scrolls to
     * the bottom of. The sentence explaining it stays at the foot, because
     * that is where somebody arrives with "what happens to all this if I go"
     * already in mind.
     */
    expect(GROUPS).toMatch(/function GroupMore\(/);
    expect(GROUPS).toMatch(/accessibilityLabel="Group settings"/);
    expect(GROUPS).toMatch(/Photos live in the albums, not in the group/);
    // And making one floats clear of the archive rather than ending it.
    expect(GROUPS).toMatch(/make: \{\s*\n\s*position: 'absolute',/);
    expect(GROUPS).toMatch(/>New album</);
  });

  it('keeps the room’s own face a letter, never a borrowed photograph', () => {
    /*
     * Older than this screen and unchanged by it: a picture from one evening
     * standing for the room says that evening is the room. The albums below
     * carry the photographs; the crest is the group's letter on its lens.
     */
    const identity = GROUPS.slice(GROUPS.indexOf('styles.identity'), GROUPS.indexOf('!group.member'));
    expect(identity).toMatch(/styles\.crest/);
    expect(identity).not.toMatch(/cover|Image/);
  });
});
