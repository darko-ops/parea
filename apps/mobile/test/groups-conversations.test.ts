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
const TAB = code(between(EVENTS, 'export function ChatsTab', 'function ConversationLine'));

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

  it('orders them by what was last said, not by what was last uploaded', () => {
    // A silent album full of photographs above the one somebody is talking in
    // is the wrong answer on a tab about talking.
    /*
     * The group chats, by when something was last said. A group nobody has
     * spoken in has no message to sort by and goes last — `lastActiveAt` would
     * sort it by album activity, which is a different tab's subject.
     */
    expect(TAB).toMatch(
      /\(b\.lastMessage\?\.at \?\? ''\)\.localeCompare\(a\.lastMessage\?\.at \?\? ''\)/,
    );
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
    expect(TAB.indexOf('groupChats.map((group')).toBeGreaterThan(gate);
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
  it('is written once and drawn where conversations are', () => {
    /*
     * A group's chat and an album's comments are two kinds of room and one
     * kind of row; written twice they drift the first time somebody changes
     * how a name is emphasised. So the row is one function.
     *
     * One caller now, and it is the Chats tab — which is the whole of that
     * tab's subject. The second was the foot of a group block on Find, and
     * that block is a door now: the page whose job is locating a room says
     * which rooms are yours, and the tab whose job is the talking says what
     * was said in them. A line of somebody's conversation under an icon on a
     * search page was the two answering each other's question.
     */
    expect(EVENTS).toMatch(/function ConversationLine\(/);
    expect(EVENTS.match(/<ConversationLine/g) ?? []).toHaveLength(1);
    expect(TAB).toMatch(/<ConversationLine/);
    expect(FIND).not.toMatch(/<ConversationLine/);
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
    /*
     * A group is busy and the number is the useful part. The dot belonged to an
     * album's comments — usually a line or two, where a number is precision
     * nobody asked for — and those are not on this tab any more. The style
     * survives because the photo viewer still draws one.
     */
    expect(EVENTS).toMatch(/styles\.unreadPill/);
    expect(TAB).not.toMatch(/dot=/);
  });

  it('says "You" rather than your own name back at you', () => {
    expect(EVENTS).toMatch(/last\.mine \? 'You' : last\.author/);
  });
});

describe('where a row goes', () => {
  it('separates the room from its conversation', () => {
    /*
     * A door on Find opens the room — its people and its evenings. The talk
     * is a different screen and it is reached from the tab that is only talk,
     * which is why Find no longer takes a way into one: a page with two
     * destinations per group asks somebody to aim.
     */
    expect(FIND).toMatch(/onPress=\{\(\) => onOpenGroup\(group\.id\)\}/);
    expect(FIND).not.toMatch(/onOpenGroupThread/);
    expect(read('App.tsx')).not.toMatch(
      /<SearchTab[\s\S]*?onOpenGroupThread[\s\S]*?\/>/,
    );
    // And on Chats a row is only ever the conversation — the room itself is a
    // page you reach from Find.
    expect(TAB).toMatch(/onPress=\{\(\) => onOpenGroupThread\(group\)\}/);
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
    /*
     * And the room holds the conversation itself now rather than sending
     * anybody to this screen: `GroupChat` is this file's body, lifted out so
     * one conversation is drawn in both places. The screen survives because
     * the Chats tab opens a conversation directly — a row there is a thread,
     * not the room around it — which is also why its header still needs a
     * name and two counts.
     */
    const GROUPS = read('src/Groups.tsx');
    expect(GROUP_THREAD).toMatch(/export function GroupChat\(/);
    expect(GROUPS).toMatch(/<GroupChat /);
    expect(GROUPS).not.toMatch(/onOpenThread/);
    expect(APP).not.toMatch(/onOpenThread=/);
  });
});

describe('what the server had to grow', () => {
  it('asks for both halves of a row in the list call, not per row', () => {
    expect(API).toMatch(/export type ThreadLine = \{/);
    expect(API).toMatch(/unreadCount: number;/);
    /*
     * Events carry one too, so an event chat can be drawn from the same list
     * the home screen already loads — but not by intersecting `ThreadLine`
     * any more. A row in this tab draws a name, some words and a time; an
     * album's card on Home draws the person as well, so the listing spells
     * its own `lastMessage` with a face and a lens key on it. Both are built
     * from `Said`, which is the half they share.
     */
    expect(API).toMatch(/export type Said = \{ author: string; body: string; at: string; mine: boolean \};/);
    expect(API).toMatch(/lastMessage: Said \| null;/);
    expect(API).toMatch(
      /lastMessage: \(Said & \{ avatarUrl: string \| null; authorKey: string \}\) \| null;/,
    );
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
 * How many rooms Find opens with.
 *
 * Two rows, and said as that rather than as a number: it was 6 while the
 * shelf was three across, and widening the shelf to four would have left it a
 * row of four and a row of two — a corner missing, and an "All groups" button
 * under it for the sake of two rooms.
 *
 * Before that it was three, which was a measurement of the block the doors
 * replaced: a name, a strip of covers and a line of conversation came to
 * about a hundred points, so somebody in eight groups scrolled past six of
 * them to reach what was underneath. A door and its name is a fraction of
 * that, so three would now buy one line of icons with a button under it —
 * more chrome than list.
 */
describe('the first few', () => {
  it('draws two rows, then a way to the rest', () => {
    expect(EVENTS).toMatch(/const GROUPS_SHOWN = GROUP_COLUMNS \* 2;/);
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

  it('says so when nothing matches', () => {
    // A head, a field and an empty page reads as the tab having failed to
    // load, rather than as an answer.
    expect(TAB).toMatch(/looking !== '' && groupChats\.length === 0/);
    expect(flat(TAB)).toMatch(/No chat of yours matches/);
    /*
     * And it says whether the other tab has any, because a search that found
     * nothing here and four there looks, from here, exactly like a search that
     * found nothing at all. The other tab's own number says how many; this is
     * the sentence that sends somebody to look at it.
     */
    // And where the other kind of conversation is. Taking the list away
    // without saying where it went is how somebody concludes their comments
    // have been deleted.
    expect(flat(TAB)).toMatch(/comments on photographs are on the album they belong to/);
  });

  it('does not offer a search where there is nothing to search', () => {
    // On a tab with no rooms and no conversations, a search box is a control
    // that cannot succeed, sitting over the paragraph saying why.
    expect(TAB).toMatch(/\{!nothing && \(/);
    expect(TAB).toMatch(/const nothing = groups\.length === 0 && looking === ''/);
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

/**
 * The tab is the group chats, and only those.
 *
 * It has been three shapes. Two headings stacked; then two tabs behind a
 * trough; now one list. The first two kept the same problem alive — the
 * product looked like it had three places to talk, when it has two and one of
 * those two was being listed twice.
 *
 * A comment belongs to the photograph it is about, so it stays there. What the
 * list on this tab was genuinely providing is the way *back* to a conversation
 * you are part of but did not start, and that is Lately's job: `comment_reply`
 * in `activity.ts` did not exist until this list went, and its absence is why
 * the list seemed necessary.
 */
describe('one list, of rooms', () => {
  it('holds no album comments', () => {
    expect(TAB).not.toMatch(/albumChats/);
    expect(TAB).not.toMatch(/onOpenEventThread/);
    expect(TAB).not.toMatch(/ALBUM COMMENTS/);
  });

  it('has no side to be on', () => {
    // The trough, its counts, and the state behind them.
    expect(TAB).not.toMatch(/setSide/);
    expect(TAB).not.toMatch(/styles\.sides/);
    expect(EVENTS).not.toMatch(/sideTabOn:/);
  });

  it('asks the field for chats, in those words', () => {
    expect(TAB).toMatch(/placeholder="Search chats"/);
    expect(TAB).toMatch(/accessibilityLabel="Search chats"/);
  });

  it('says where the other kind of conversation is', () => {
    /*
     * On the empty tab and again when a search finds nothing. Taking the list
     * away without saying where it went is how somebody concludes their
     * comments have been deleted.
     */
    expect(flat(TAB)).toMatch(/Comments on photographs live on the album they belong to/);
    expect(flat(TAB)).toMatch(/comments on photographs are on the album they belong to/);
    // And it names the tray, which is the route back to one.
    expect(flat(TAB)).toMatch(/turn up in your tray when somebody answers you/);
  });

  it('draws the door as a letter, never a photograph', () => {
    // The rule the group blocks on Find follow: a group has no picture of its
    // own, and borrowing one out of an evening inside it would put something
    // from a room on the way in to it.
    expect(TAB).toMatch(/styles\.chatLetter/);
    expect(TAB).toMatch(/lensFor\(group\.id\)/);
    expect(TAB).not.toMatch(/album\?\.cover/);
  });
});

/**
 * And the route back, which had to be built before the list could go.
 */
describe('a reply reaches you through Lately', () => {
  const ACTIVITY = readFileSync(
    fileURLToPath(new URL('../../web/src/activity.ts', import.meta.url).href),
    'utf8',
  );

  it('carries a reply as well as a comment on your own photograph', () => {
    /*
     * `photo_comment` is about the picture being *yours*. A reply to your
     * comment under somebody else's photograph reached you nowhere at all —
     * survivable while the Chats tab listed album comments, and the reason
     * that list could not simply be deleted.
     */
    expect(ACTIVITY).toMatch(/\| 'comment_reply'/);
    expect(ACTIVITY).toMatch(/kind: 'comment_reply' as const/);
    expect(ACTIVITY).toMatch(/where you commented, in \$\{c\.eventName\}/);
  });

  it('is what a reply means on a flat board', () => {
    // There are no threads under a photograph, so replying is saying something
    // where you have already said something.
    expect(ACTIVITY).toMatch(/mine\.author_actor_id = \$\{actorId\}/);
  });

  it('does not double up with the uploader case', () => {
    /*
     * Both queries would match a comment on your own photograph that you had
     * also commented on, and both build their key from the message id — so the
     * feed would carry the same remark twice.
     */
    expect(ACTIVITY).toMatch(/ne\(schema\.photos\.uploaderId, actorId\)/);
    expect(ACTIVITY).toMatch(/id: `reply:\$\{c\.id\}`/);
    expect(ACTIVITY).toMatch(/id: `comment:\$\{c\.id\}`/);
  });

  it('leaves out your own remarks and anything deleted', () => {
    /*
     * The end anchor is searched *from* the start, not from the top of the
     * file — "Somebody said you are in a photograph" also appears in the
     * `ActivityKind` doc a few hundred lines above, so a plain `indexOf` gives
     * an end before the start and a slice that reads nothing.
     */
    /*
     * `lastIndexOf`, because the sentence appears twice: once on the kind in
     * the `ActivityKind` union and once over the query itself. The first hit
     * gave a slice containing only the doc comment, which matched none of the
     * assertions below and looked like the query was missing them.
     */
    const from = ACTIVITY.lastIndexOf(
      'Somebody else said something under a photograph you commented on',
    );
    const to = ACTIVITY.indexOf('Somebody said you are in a photograph', from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const replies = ACTIVITY.slice(from, to);
    expect(replies).toMatch(/ne\(schema\.eventMessages\.authorActorId, actorId\)/);
    expect(replies).toMatch(/isNull\(schema\.eventMessages\.deletedAt\)/);
    expect(replies).toMatch(/isNull\(schema\.photos\.deletedAt\)/);
    expect(replies).toMatch(/mine\.deleted_at is null/);
  });
});
