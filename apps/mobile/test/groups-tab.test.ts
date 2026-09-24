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
    const chats = APP.indexOf("['chats', 'bubbles', 'Chats']");
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

  it('says there is nothing to recognise, and no more than that', () => {
    /*
     * The second half of this used to assert the explanation under the line —
     * where groups come from, and what the box above would and would not
     * find. Four sentences, read by somebody who has not asked a question
     * yet, which is a paragraph in front of an empty screen. Removed by
     * request; the line that says why the screen is empty stays.
     */
    expect(flat(EVENTS)).toMatch(/You are not in any groups yet/);
    expect(flat(EVENTS)).not.toMatch(/Groups are for the people who keep turning up/);
  });

  it('draws the door as a letter, never as a photograph', () => {
    /*
     * The rule is about *the door*, and it is the whole of the shelf now: a
     * group is a letter on the lens colour its id hashes to, three across
     * with the name underneath, and nothing about a group is ever drawn from
     * a picture.
     */
    const shelf = between(tab, 'YOUR GROUPS', 'All groups');
    expect(shelf).toMatch(/styles\.door,/);
    expect(shelf).toMatch(/lensFor\(group\.id\)/);
    expect(shelf).toMatch(/initialOf\(group\.name\)/);
    expect(EVENTS).toMatch(/const GROUP_COLUMNS = 3;/);
    expect(EVENTS).toMatch(/doors: \{ flexDirection: 'row', flexWrap: 'wrap', gap: GROUP_GAP \}/);
    expect(EVENTS).toMatch(/\(width - 40 - GROUP_GAP \* \(GROUP_COLUMNS - 1\)\) \/ GROUP_COLUMNS/);
  });

  it('puts no photograph under a group at all', () => {
    /*
     * The shelf drew three of this viewer's own covers under each group's
     * name for a while, and what made that safe was a bound on *where the
     * picture came from*: the albums this actor can already open, never the
     * group or its detail response — so somebody who was never in one of a
     * group's events, or who has since been removed, contributed no tile.
     *
     * The doors settle it more simply, by having no picture in them. The
     * original worry was a group handing a photograph out of a room to
     * somebody merely standing at the door; there is now nothing on this
     * screen for such a photograph to arrive through.
     */
    const shelf = between(tab, 'YOUR GROUPS', 'All groups');
    expect(shelf).not.toMatch(/uri:/);
    expect(shelf).not.toMatch(/<Image/);
    expect(EVENTS).not.toMatch(/stripEmpty|stripShot|withCovers/);

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

  it('is shaped like an album: a head, three tabs, one pane', () => {
    /*
     * An evening and a room are the same kind of object to somebody holding
     * the phone — a thing with pictures in it, a conversation about them, and
     * the people it belongs to — and drawing them two ways makes a reader
     * learn the product twice.
     *
     * The head is fixed for the reason an album's cover is: the tabs under it
     * must not move when a name runs to two lines, and a row of tabs that
     * shifts is a row somebody mis-taps.
     */
    expect(GROUPS).toMatch(/const HEAD = 176;/);
    expect(GROUPS).toMatch(/head: \{ height: HEAD, borderBottomWidth: 1/);
    expect(GROUPS).toMatch(/page: \{ position: 'absolute', top: HEAD, left: 0, right: 0, bottom: 0 \}/);
    expect(GROUPS).toMatch(/export type GroupPane = 'albums' \| 'chat' \| 'people';/);
    expect(GROUPS).toMatch(/\['albums', 'photos', 'Albums'\]/);
    expect(GROUPS).toMatch(/\['chat', 'bubbles', 'Chat'\]/);
    expect(GROUPS).toMatch(/\['people', 'group', 'People'\]/);

    /*
     * A door has no panes to switch between: no albums, no conversation and
     * no list of people, so the screen does not draw three tabs that would
     * all be empty.
     */
    expect(GROUPS).toMatch(/\{!group\.member \? \(/);
  });

  it('shelves albums the way the profile does, two across', () => {
    /*
     * It was an archive: the newest full-bleed at 4:5, the rest as rows under
     * month and year rules. That reads well on its own and reads like a third
     * kind of album list — these are the same objects the profile shelves, so
     * they are drawn the way it shelves them. The date each rule carried is
     * under every tile, which is where the profile has always put it.
     */
    expect(GROUPS).toMatch(/const COLUMNS = 2;/);
    expect(GROUPS).toMatch(/const tile = Math\.floor\(\(width - 40 - GAP \* \(COLUMNS - 1\)\) \/ COLUMNS\);/);
    expect(GROUPS).toMatch(/function AlbumTile\(/);
    expect(GROUPS).toMatch(/grid: \{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP \}/);
    // The same arithmetic and the same two constants as the shelf it borrows.
    const PROFILE = read('src/Profile.tsx');
    expect(PROFILE).toMatch(/const tile = Math\.floor\(\(width - 40 - GAP \* \(COLUMNS - 1\)\) \/ COLUMNS\);/);
    expect(PROFILE).toMatch(/const COLUMNS = 2;/);
    // And the tile itself, number for number.
    for (const rule of [
      /tile: \{ width: '100%', height: 120, borderRadius: 12, backgroundColor: '#8881' \}/,
      /tileName: \{ fontSize: 14, fontWeight: '600', marginTop: 6 \}/,
      /tileMeta: \{ fontSize: 12\.5 \}/,
    ]) {
      expect(GROUPS, String(rule)).toMatch(rule);
      expect(PROFILE, String(rule)).toMatch(rule);
    }
    // And what is in it, which the profile's tile also says.
    expect(GROUPS).toMatch(/'Nothing in it yet'/);
    /*
     * What the tile adds to the profile's is the pip: a room knows which
     * albums have moved since you last looked, and a person's shelf does not.
     * A dot rather than a count — the number is precision nobody asked for on
     * a tile this size.
     */
    expect(GROUPS).toMatch(/album\.fresh > 0 && \(/);
    expect(GROUPS).toMatch(/tilePip: \{/);
    // The shelf that was here is gone rather than hidden behind a flag.
    expect(GROUPS).not.toMatch(/function Feature\(|function Rule\(|monthName/);
  });

  it('holds its own conversation rather than sending somebody to it', () => {
    /*
     * It was a disc in the header that opened a screen with a second header
     * naming the group you had just left. `GroupChat` is that screen's body,
     * lifted out of `GroupThread` so both places draw one conversation — the
     * standalone screen still exists, because the Chats tab opens a
     * conversation directly rather than the room around it.
     */
    const THREAD = read('src/GroupThread.tsx');
    expect(THREAD).toMatch(/export function GroupChat\(/);
    expect(THREAD).toMatch(/export function GroupThread\(/);
    expect(THREAD).toMatch(/<GroupChat api=\{api\} group=\{group\} t=\{t\} keyboardOffset=\{HEAD\} \/>/);
    expect(GROUPS).toMatch(/import \{ GroupChat \} from '\.\/GroupThread';/);
    expect(GROUPS).toMatch(/<GroupChat api=\{api\} group=\{group\} t=\{t\} keyboardOffset=\{HEAD\} \/>/);
    // The prop that used to send somebody away is gone from both ends.
    expect(GROUPS).not.toMatch(/onOpenThread/);
    expect(read('App.tsx')).not.toMatch(/onOpenThread=/);
  });

  it('puts everyone on a tab rather than under a lid', () => {
    /*
     * A modal over a stack of faces is a pane with a lid on it. The People
     * tab is that list — and the join requests an admin used to meet above
     * the archive sit at the top of it, with the count on the tab, which is
     * the same pip an album's Comments tab carries about the same kind of
     * fact: something is waiting here.
     */
    expect(GROUPS).not.toMatch(/function Everyone\(/);
    expect(GROUPS).toMatch(/\{group\.people\.map\(\(person\) => \{/);
    expect(GROUPS).toMatch(/waiting: number;/);
    expect(GROUPS).toMatch(/id === 'people' && waiting > 0/);
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
  });

  it('adds an album from the tab row, where an album adds photographs', () => {
    /*
     * It was a floating pill above the tab bubble, put there because the
     * control for adding sat at the foot of the one list somebody scrolls to
     * the bottom of. A tab row pinned over the pane solves that without a
     * second floating object — and it is the slot the album screen already
     * uses for the room's version of the same job.
     */
    expect(GROUPS).toMatch(/accessibilityLabel="New album in this group"/);
    expect(GROUPS).toMatch(/addButton: \{/);
    expect(GROUPS).not.toMatch(/styles\.make\b/);
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
    /* And the sentence is still at the foot of the albums, which is where
       somebody arrives having scrolled them. */
    expect(GROUPS).toMatch(/Photos live in the albums, not in the group/);
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
