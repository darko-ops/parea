/**
 * The Groups tab, once it became every conversation.
 *
 * It was a directory: a letter tile, a name, a line of counts, repeated — a
 * list of rooms with no way to say anything in any of them, on the tab that is
 * meant to hold the product's conversations. The handoff's 4b makes it one
 * scroll of every thread this person has: the groups they are in, each showing
 * its own talk, and the one-off evenings that belong to no group.
 *
 * Source checks, because there is no renderer in this suite. What they are
 * guarding is mostly the two rules that are invisible until a row is wrong:
 * which conversations appear, and which of them belongs to whom.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const APP = read('App.tsx');
const API = read('src/api.ts');
const THREAD = read('src/Thread.tsx');
const GROUP_THREAD = read('src/GroupThread.tsx');

const flat = (source: string) => source.replace(/\s+/g, ' ');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * A slice that refuses to be empty. `indexOf` answers -1 for a renamed anchor
 * and `slice` then reads something other than the thing under test — silently,
 * with every assertion over it passing.
 */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  if (start < 0) throw new Error(`no ${from}`);
  if (end < 0) throw new Error(`no ${to} after ${from}`);
  return source.slice(start, end);
}

/** The Chats tab: every conversation, and nothing else. */
const TAB = code(between(EVENTS, 'export function ChatsTab', 'function GroupBlock'));

/**
 * Find, which is where the rooms themselves went.
 *
 * The two used to be one tab — the groups drawn as blocks of covers, with the
 * talk going on in them underneath. That put a hundred points of furniture per
 * group above the conversations, and left a group's own thread appearing only
 * as the last line of its block. So the rooms are the resting state of the page
 * whose subject is finding a room, and the tab they left is the talking.
 */
const FIND = code(between(EVENTS, 'export function SearchTab', 'function Result('));

describe('which conversations appear', () => {
  it('lists every album somebody has spoken in, group or no group', () => {
    /*
     * This used to exclude grouped albums, on the argument that their talk
     * belongs under the group's block and listing it twice would make the
     * busiest rooms the noisiest part of a screen meant to be scanned.
     *
     * The premise was wrong, and the cost was a conversation with nowhere to
     * be. A group's row carries *the group's own thread* — `ConversationLine`
     * is fed the group, not an album inside it — so an album in a group had
     * its talk drawn in neither place. Four messages in an evening, and the
     * only way back to them was to remember which album it was and open its
     * Talk tab.
     *
     * Nothing is listed twice, because the two lines were never the same line.
     */
    expect(TAB).toMatch(/\.filter\(\(event\) => event\.lastMessage != null\)/);
    expect(TAB).not.toMatch(/!event\.groupId && event\.lastMessage/);
    // The group's row is still about the group, which is what makes the above
    // safe rather than duplicative.
    expect(EVENTS).toMatch(/<ConversationLine\s*line=\{group\}/);
  });

  it('orders them by what was last said, not by what was last uploaded', () => {
    // A silent album full of photographs above the one somebody is talking in
    // is the wrong answer on a tab about talking.
    expect(TAB).toMatch(/b\.lastMessage!\.at\.localeCompare\(a\.lastMessage!\.at\)/);
  });

  it('puts the suggestion at the foot, below the rooms', () => {
    /*
     * A cluster is the one thing on the page that is a suggestion rather than a
     * room somebody is already in. Above the rooms it would be an offer over a
     * list of places; it belongs after them, as a remark about them.
     *
     * It followed the groups to Find, because a suggestion to make a group is
     * only useful beside the groups.
     */
    const order = ['rooms.map((group)', 'All groups', 'clusters.map((cluster)'];
    const at = order.map((needle) => FIND.indexOf(needle));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(TAB).not.toMatch(/<ClusterCard/);
  });

  it('leaves out an event nobody has spoken in', () => {
    /*
     * A reversal. These used to list whether or not anything had been said, on
     * the argument that an empty chat is a door. In practice it filled the
     * section with rows reading "Nobody has said anything yet" — a list of
     * absences under a heading promising conversations. The door is the album's
     * own Talk tab now.
     */
    expect(TAB).toMatch(/event\.lastMessage != null/);
    // A group block can still be empty and worth drawing: the room exists
     // whether or not anybody has spoken in it.
    expect(EVENTS).toMatch(/Nobody has said anything yet\./);
  });
});

describe('what the tab is called', () => {
  it('is not called anything', () => {
    /*
     * It said "Your Parea", which was chosen over "Groups" because the tab
     * holds the rooms and the conversations and the word for all of that is
     * the one the product is named after. Both were the same mistake at
     * different volumes: a 30pt line naming the tab you just pressed, above
     * the rooms you pressed it to reach.
     *
     * What opens it now is what opens every tab — the product's name, in the
     * same place, from `PageHead`.
     */
    expect(TAB).not.toMatch(/>Your Parea</);
    expect(TAB).not.toMatch(/>Groups</);
    expect(TAB).toMatch(/<PageHead/);
  });

  it('calls the album conversations album chats', () => {
    /*
     * A reversal, and the reason is the question it kept producing: *why are
     * my groups' chats not in the group chats?*
     *
     * This heading read GROUP CHATS over a list of album conversations. The
     * groups' own threads are not here at all — they are one line each on the
     * blocks above — so the heading promised the one thing under it that was
     * missing, and named the rows beneath it after somewhere they do not live.
     *
     * "EVENT CHATS" was rejected here once and stays rejected: `event` is the
     * schema's word and no reader of this product ever sees it. The reader's
     * word for what these belong to is album.
     */
    expect(TAB).toMatch(/>ALBUM CHATS</);
    expect(TAB).not.toMatch(/EVENT CHATS/);
    /*
     * And GROUP CHATS is now a heading over the group chats, which is what it
     * always said it was. The two sections are the fix: the groups' threads
     * were never in this list — they were the last line of a block in a tab
     * that has since become Find.
     */
    expect(TAB).toMatch(/>GROUP CHATS</);
    expect(TAB.indexOf('GROUP CHATS')).toBeLessThan(TAB.indexOf('ALBUM CHATS'));
  });
});

describe('the tab arrives in one piece', () => {
  it('draws nothing at all until every part of it can be drawn', () => {
    /*
     * The event chats are built from `events`, a prop the tabs already hold, so
     * they would be on screen a round trip before the groups they sit beneath —
     * the minor half of the tab first, with the rooms dropping in above it and
     * pushing down whatever somebody had started reading.
     *
     * The gate used to sit *under* the heading, which fixed that and left a
     * smaller version of the same thing: the first paint was a title and two
     * discs over an empty space, and the page proper arrived a round trip
     * later. Two arrivals for one screen, and the half that landed first was
     * the half that only says where you are.
     *
     * So it is an early return now, above the `ScrollView` — before the title,
     * before the buttons, before anything.
     */
    const gate = TAB.indexOf('if (groups === null) {');
    expect(gate).toBeGreaterThan(-1);
    const tree = TAB.indexOf('<ScrollView');
    expect(gate).toBeGreaterThan(-1);
    expect(tree).toBeGreaterThan(gate);
    // Including the head, which is the part this moved. It was the "Your
    // Parea" heading; it is the wordmark row now, and the rule is the same.
    expect(TAB.indexOf('<PageHead')).toBeGreaterThan(gate);
    expect(TAB.indexOf('GROUP CHATS')).toBeGreaterThan(gate);
    expect(TAB.indexOf('ALBUM CHATS')).toBeGreaterThan(gate);
    expect(TAB.indexOf('groupChats.map((group')).toBeGreaterThan(gate);
    expect(TAB.indexOf('albumChats.map((event')).toBeGreaterThan(gate);
  });

  it('blanks the screen on the first paint only', () => {
    /*
     * `load` never puts `groups` back to null, so returning to the tab redraws
     * the page it already had and fills in behind it. An early return that
     * cleared on every refetch would flash the title away on every tab switch,
     * which is a worse version of the problem it was written for.
     */
    expect(TAB).toMatch(/setGroups\(await api\.myGroupsDetailed\(\)/);
    expect(TAB).not.toMatch(/setGroups\(null\)/);
  });
});

describe('one conversation, as one line', () => {
  it('is written once and drawn in both places', () => {
    // A group block and an event-chat row are the same sentence about two
    // kinds of room; written twice they drift.
    expect(EVENTS).toMatch(/function ConversationLine\(/);
    // Three: a group's row and an album's row on Chats, and the foot of a
    // group block on Find.
    expect(EVENTS.match(/<ConversationLine/g) ?? []).toHaveLength(3);
  });

  it('carries unread in the ink as well as in the badge', () => {
    // The pill alone is a small blue circle somebody has to find; the weight
    // of the line is what they see first.
    expect(EVENTS).toMatch(/color: unread \? t\.fg : t\.dim/);
  });

  it('is a count on a group and a dot on an event chat', () => {
    /*
     * A group is busy and the number is the useful part; an event chat is
     * usually one or two messages, and a number there is precision nobody
     * asked for.
     */
    expect(EVENTS).toMatch(/styles\.unreadPill/);
    expect(EVENTS).toMatch(/styles\.unreadDot/);
    // The dot is asked for at the event-chat call site and nowhere else.
    expect(EVENTS.match(/<ConversationLine line=\{event\} t=\{t\} dot \/>/g) ?? [])
      .toHaveLength(1);
  });

  it('says "You" rather than your own name back at you', () => {
    expect(EVENTS).toMatch(/last\.mine \? 'You' : last\.author/);
  });
});

describe('where a row goes', () => {
  it('separates the room from its conversation', () => {
    // The block is the group — its people and its evenings. The line at the
    // foot is the talk, which is a different screen.
    expect(FIND).toMatch(/onPress=\{\(\) => onOpenGroup\(group\.id\)\}/);
    expect(FIND).toMatch(/onOpenThread=\{\(\) => onOpenGroupThread\(group\)\}/);
    // And on Chats a group's row is only ever the conversation — the room
    // itself is a page you reach from Find.
    expect(TAB).toMatch(/onPress=\{\(\) => onOpenGroupThread\(group\)\}/);
  });

  it('opens an event chat on the conversation rather than the photographs', () => {
    expect(APP).toMatch(/onOpenEventThread=\{\(listing\) => \{\s*void open\(listing, 'talk'\);/);
  });

  it('still opens a link on the photographs, always', () => {
    /*
     * The rule that survives: an event's *link* must never open on its roster
     * or halfway down somebody's conversation. The pane is optional and only
     * an in-app row that is itself a conversation sets it.
     */
    expect(APP).toMatch(/useState<Pane>\(initialPane \?\? 'photos'\)/);
    expect(APP).toMatch(/pane\?: Pane;/);
    // The deep-link path does not pass one.
    expect(APP).not.toMatch(/screen: 'event', event, pane: '(talk|people)'/);
  });
});

describe('a group’s own thread', () => {
  it('reuses the album’s thread rather than drawing a second one', () => {
    // Same composer, same tombstones, same mention rules.
    expect(GROUP_THREAD).toMatch(/import \{ Thread \} from '\.\/Thread'/);
    expect(THREAD).toMatch(/export type ThreadActions/);
  });

  it('is given its verbs rather than reaching for them', () => {
    /*
     * A message id from `group_message` is not a message id from
     * `event_message`, and a component that guessed which route to call would
     * be one that can guess wrong.
     */
    expect(THREAD).toMatch(/actions: ThreadActions;/);
    expect(THREAD).not.toMatch(/api\.postMessage|api\.deleteMessage|api\.editMessage/);
    expect(GROUP_THREAD).toMatch(/api\.postGroupMessage\(group\.id, body\)/);
    expect(APP).toMatch(/post: \(body: string\) => api\.postMessage\(event\.id, body\)/);
  });

  it('draws no reaction picker where there is nothing behind it', () => {
    // A group message has no reactions yet; offering a picker that does
    // nothing is worse than not offering one.
    expect(THREAD).toMatch(/canPost && canReact/);
    expect(THREAD).toMatch(/canReact=\{actions\.react != null\}/);
  });

  it('carries the summary it already has rather than re-fetching a title', () => {
    /*
     * Re-reading a name and a member count to render a header is a spinner
     * where a name should be.
     *
     * The route carries what the bar needs rather than a whole
     * `MyGroupDetail`, because there are two ways in now: the Groups tab holds
     * one of those, and the group's own page holds a `GroupRoom`. Each
     * satisfies this shape without inventing the other's fields, and the
     * screen was reading four properties off the larger one anyway.
     */
    expect(APP).toMatch(
      /group: \{ id: string; name: string; memberCount: number; eventCount: number \};/,
    );
    expect(GROUP_THREAD).toMatch(
      /group: \{ id: string; name: string; memberCount: number; eventCount: number \};/,
    );
    // And the room itself opens it, which it could not before: the thread was
    // reachable only from the envelope on the Groups tab, so a group opened
    // from a search result or from one of its albums had the talking sealed off.
    expect(APP).toMatch(/onOpenThread=\{\(group\) =>/);
    const GROUPS = read('src/Groups.tsx');
    expect(GROUPS).toMatch(/onPress=\{\(\) => onOpenThread\(group\)\}/);
  });
});

describe('what the server had to grow', () => {
  it('asks for both halves of a row in the list call, not per row', () => {
    expect(API).toMatch(/export type ThreadLine = \{/);
    expect(API).toMatch(/unreadCount: number;/);
    // Events carry one too, so an event chat can be drawn from the same list
    // the home screen already loads.
    expect(API).toMatch(/\} & ThreadLine;/);
  });

  it('marks an event read explicitly rather than as a side effect', () => {
    /*
     * The phone reads photographs, roster and thread out of one request.
     * Clearing a badge because somebody opened an album would clear it for a
     * conversation they never looked at.
     */
    expect(API).toMatch(/markEventRead\(eventId: string, linkToken: string\)/);
    expect(API).toMatch(/\/api\/events\/\$\{eventId\}\/read/);
  });

  it('keeps a group’s messages on their own path', () => {
    expect(API).toMatch(/\/api\/groups\/\$\{groupId\}\/messages/);
    expect(API).toMatch(/\/api\/group-messages\/\$\{messageId\}/);
  });
});

/**
 * How many rooms the tab opens with.
 *
 * A group block is a name, a strip of covers and a line of conversation — about
 * a hundred points each — so somebody in eight groups scrolled past six of them
 * to reach the one-off conversations underneath, every single time they opened
 * the tab.
 */
describe('the first three', () => {
  it('draws three, then a way to the rest', () => {
    expect(EVENTS).toMatch(/const GROUPS_SHOWN = 3;/);
    expect(FIND).toMatch(/ordered\.slice\(0, GROUPS_SHOWN\)/);
    expect(FIND).toMatch(/>\s*All groups\s*</);
    // And no button when there is nothing behind it.
    expect(FIND).toMatch(/mine\.length > rooms\.length && \(/);
  });

  it('picks the three most recently added to, not the first three it was sent', () => {
    // An unsorted list from the server is arbitrary from this screen's point of
    // view, and "the three you last did something in" is the only ordering that
    // makes a cut of three worth having.
    expect(FIND).toMatch(/b\.lastActiveAt \?\? ''\)\.localeCompare\(a\.lastActiveAt \?\? ''\)/);
  });

  it('opens in place rather than pushing another screen', () => {
    // The full list is this same list. A second screen would be a second place
    // where a group block is drawn.
    expect(FIND).toMatch(/setAllGroups\(true\)/);
    expect(FIND).toMatch(/allGroups \? ordered : ordered\.slice/);
  });
});

/**
 * Searching the tab that holds every conversation.
 *
 * The tab grows without bound — a group per circle of people, an album chat
 * per evening — and the only ordering it has is recency, which is the right
 * default and no help at all for something said in March. Three groups are
 * behind a "show all" and the album chats are a flat list under them.
 */
describe('finding one', () => {
  it('searches what was said, not only what things are called', () => {
    /*
     * Somebody looking for a conversation is as likely to remember a word out
     * of it as the name of the room it happened in. Matching titles alone
     * refuses the more useful half of the question on a tab that is only
     * conversations.
     */
    expect(TAB).toMatch(/matches\(group\.name, group\.lastMessage\?\.body, group\.lastMessage\?\.author\)/);
    expect(TAB).toMatch(/matches\(event\.name, event\.lastMessage\?\.body, event\.lastMessage\?\.author\)/);
  });

  it('matches without regard to case, and ignores stray spaces', () => {
    expect(TAB).toMatch(/query\.trim\(\)\.toLowerCase\(\)/);
    expect(TAB).toMatch(/field\?\.toLowerCase\(\)\.includes\(looking\)/);
  });

  it('matches everything when nothing has been typed', () => {
    // The filter runs on every render whether or not anybody is searching, so
    // an empty query has to pass everything rather than match nothing.
    expect(TAB).toMatch(/!looking \|\| fields\.some/);
  });

  it('searches both sections at once', () => {
    // One field over the whole tab, rather than a field per heading. The
    // question is "where was that said", and somebody asking it does not
    // already know whether it was an evening or the room.
    expect(TAB.match(/<TextInput/g) ?? []).toHaveLength(1);
    expect(TAB).toMatch(/groupChats = useMemo/);
    expect(TAB).toMatch(/albumChats = useMemo/);
  });

  it('says so when nothing matches', () => {
    // A head, a field and an empty page reads as the tab having failed to
    // load, rather than as an answer.
    expect(TAB).toMatch(
      /looking !== '' && groupChats\.length === 0 && albumChats\.length === 0/,
    );
    expect(TAB).toMatch(/Nothing here matches/);
    // And points at the one place the thing they want might still be.
    expect(flat(TAB)).toMatch(/the groups themselves are on Find/);
  });

  it('does not offer a search where there is nothing to search', () => {
    // On a tab with no rooms and no conversations, a search box is a control
    // that cannot succeed, sitting over the paragraph saying why.
    expect(TAB).toMatch(/\{!nothing && \(/);
    expect(TAB).toMatch(
      /const nothing = groups\.length === 0 && albumChats\.length === 0 && looking === ''/,
    );
  });

  it('forgets the query on the way out', () => {
    /*
     * A search is something somebody is in the middle of, not a setting. A
     * stale one hides most of the tab on arrival with the reason for it
     * scrolled off the top — the same screen as the bug this replaced.
     */
    expect(TAB).toMatch(/setQuery\(''\);/);
    expect(TAB).toMatch(/if \(!active\) \{/);
  });

  it('is the field Find already has', () => {
    // Two search fields in one app that look like two different controls is
    // the drift this shares a stylesheet to avoid.
    expect(TAB).toMatch(/style=\{\[styles\.field, \{ backgroundColor: t\.card, borderColor: t\.line \}\]\}/);
    expect(TAB).toMatch(/<Glyph name="search"/);
    expect(TAB).toMatch(/style=\{\[styles\.fieldText, \{ color: t\.fg \}\]\}/);
  });

  it('has a way out that is not the backspace key', () => {
    expect(TAB).toMatch(/accessibilityLabel="Clear search"/);
    expect(TAB).toMatch(/onPress=\{\(\) => setQuery\(''\)\}/);
  });
});

