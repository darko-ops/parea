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

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TAB = code(
  EVENTS.slice(EVENTS.indexOf('export function GroupsTab'), EVENTS.indexOf('function GroupBlock')),
);

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
     * A cluster is the one thing on this tab that is a suggestion rather than
     * a room somebody is already in. Between the groups and the event chats it
     * read as a break in the list of places rather than as a remark about it.
     */
    const order = ['shown.map((group)', 'GROUP CHATS', 'clusters.map((cluster)'];
    const at = order.map((needle) => TAB.indexOf(needle));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
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

  it('calls the one-off conversations group chats', () => {
    expect(TAB).toMatch(/>GROUP CHATS</);
    expect(TAB).not.toMatch(/EVENT CHATS/);
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
    const tree = TAB.indexOf('<ScrollView');
    expect(gate).toBeGreaterThan(-1);
    expect(tree).toBeGreaterThan(gate);
    // Including the head, which is the part this moved. It was the "Your
    // Parea" heading; it is the wordmark row now, and the rule is the same.
    expect(TAB.indexOf('<PageHead')).toBeGreaterThan(gate);
    expect(TAB.indexOf('GROUP CHATS')).toBeGreaterThan(gate);
    expect(TAB.indexOf('clusters.map((cluster)')).toBeGreaterThan(gate);
    expect(TAB.indexOf('shown.map((group)')).toBeGreaterThan(gate);
  });

  it('blanks the screen on the first paint only', () => {
    /*
     * `load` never puts `groups` back to null, so returning to the tab redraws
     * the page it already had and fills in behind it. An early return that
     * cleared on every refetch would flash the title away on every tab switch,
     * which is a worse version of the problem it was written for.
     */
    expect(TAB).toMatch(/setGroups\(mine\)/);
    expect(TAB).not.toMatch(/setGroups\(null\)/);
  });
});

describe('one conversation, as one line', () => {
  it('is written once and drawn in both places', () => {
    // A group block and an event-chat row are the same sentence about two
    // kinds of room; written twice they drift.
    expect(EVENTS).toMatch(/function ConversationLine\(/);
    expect(EVENTS.match(/<ConversationLine/g) ?? []).toHaveLength(2);
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
    expect(TAB).toMatch(/onPress=\{\(\) => onOpenGroup\(group\.id\)\}/);
    expect(TAB).toMatch(/onOpenThread=\{\(\) => onOpenGroupThread\(group\)\}/);
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
    expect(TAB).toMatch(/ordered\.slice\(0, GROUPS_SHOWN\)/);
    expect(TAB).toMatch(/>\s*All groups\s*</);
    // And no button when there is nothing behind it.
    expect(TAB).toMatch(/groups\.length > shown\.length && \(/);
  });

  it('picks the three most recently added to, not the first three it was sent', () => {
    // An unsorted list from the server is arbitrary from this screen's point of
    // view, and "the three you last did something in" is the only ordering that
    // makes a cut of three worth having.
    expect(TAB).toMatch(/b\.lastActiveAt \?\? ''\)\.localeCompare\(a\.lastActiveAt \?\? ''\)/);
  });

  it('opens in place rather than pushing another screen', () => {
    // The full list is this same list. A second screen would be a second place
    // where a group block is drawn.
    expect(TAB).toMatch(/setAllGroups\(true\)/);
    expect(TAB).toMatch(/allGroups \? ordered : ordered\.slice/);
  });
});
