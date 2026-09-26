/**
 * Making a group on the phone, and the rules that are easy to lose.
 *
 * The Groups tab used to assert the *absence* of a create action — see
 * `groups-tab.test.ts`, which said a group is made from an event and there is
 * nothing to press. That reversed, and what replaced the absence is what has
 * to be guarded now: creation is offered only alongside the people it would be
 * made with, the card writes nothing until Create, and the sentence saying
 * what Create does to other people is above the button.
 *
 * The privacy rule behind the clusters is proven against a real database in
 * the web suite (`clusters.test.ts`) — somebody who was not at those events
 * learns nothing. What is here is the client half: the phone asks the server
 * and never derives them itself.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

/* The suggestion card. The form that used to live beside it is a page now. */
const FORM = read('src/CreateGroup.tsx');
const PAGE = read('src/NewGroup.tsx');
const EVENTS = read('src/Events.tsx');
const APP = read('App.tsx');
/** The Chats tab, which is what the old Groups tab became. */
const CHATS = EVENTS.slice(
  EVENTS.indexOf('export function ChatsTab'),
  EVENTS.indexOf('function ConversationLine'),
);
const API = read('src/api.ts');

describe('where the clusters come from', () => {
  it('is the server, never the device', () => {
    /*
     * They are derived from other people's presence at events. A client that
     * assembled them would need everybody else's participation to do it, which
     * is precisely the data the link model exists to keep out of a client.
     */
    expect(API).toMatch(/clusters\(\) \{[\s\S]*?'\/api\/groups\/clusters'/);
    expect(FORM).not.toMatch(/event_participant|participants/);
    expect(EVENTS).toMatch(/api\.clusters\(\)/);
  });

  it('is never cached on the device', () => {
    // A stale copy would offer to make a group out of a set that has since
    // become two. Nothing here writes them to storage.
    expect(EVENTS).not.toMatch(/saveClusters|AsyncStorage[\s\S]{0,40}cluster/i);
  });
});

describe('nothing is written until Create', () => {
  it('makes exactly one call, and it is the create', () => {
    /*
     * Opening the page, removing somebody and backing out must all be free —
     * that is the property that makes suggesting a set of people acceptable
     * rather than presumptuous.
     *
     * The card itself now calls nothing at all: it suggests, and the page it
     * opens is where the one call lives.
     */
    expect(FORM.match(/api\.[a-zA-Z]+\(/g) ?? []).toEqual([]);
    const calls = PAGE.match(/api\.[a-zA-Z]+\(/g) ?? [];
    expect(calls).toEqual(['api.createChat(']);
  });

  it('sends people, not an event, and a name only when there is one', () => {
    /*
     * The roll-up is a different act on a different endpoint shape, and the
     * two are kept as separate methods for that reason.
     *
     * The name is optional now and its absence is load-bearing: the Chats
     * tab's `+` asks who and nothing else, and a body with no `name` is what
     * tells the server to title the room from its people. An empty string
     * would be a name somebody gave and cleared, which is a different row —
     * see `schema.ts` on why the column keeps the two apart.
     */
    expect(API).toMatch(/createChat\(memberIds: string\[\], name\?: string\)/);
    expect(API).toMatch(
      /JSON\.stringify\(name \? \{ name, memberIds \} : \{ memberIds \}\)/,
    );
  });
});

describe('what the screen says', () => {
  it('says what Create does to other people, before Create', () => {
    /*
     * Creating from people adds them outright rather than asking. That is a
     * real thing to do to somebody, so the sentence saying it has to be read
     * before the decision rather than reported in a confirmation after it.
     *
     * The page puts Create in the bar at the top, so "above the button" is no
     * longer the test — what survives is that the sentence is on the screen and
     * is about what happens to them, not about what happens to you.
     */
    expect(PAGE).toMatch(/they are not asked first/);
    expect(PAGE).toMatch(/They can leave whenever they like/);
  });

  it('says something different when nobody has been added', () => {
    // "Everyone you add is in the group straight away" is an instruction about
    // people who are not there yet, on a page that may legitimately be
    // submitted empty.
    expect(PAGE).toMatch(/picked\.length > 0\s*$|picked\.length > 0\s*\n?\s*\?/m);
    expect(PAGE).toMatch(/You can make it empty and add people later/);
  });

  it('never calls a cluster a group', () => {
    // They are recurring sets of people until somebody presses something.
    expect(EVENTS).not.toMatch(/you already have|unnamed groups/i);
    // And the vocabulary the design dropped: nobody has to learn a second word
    // for making a group with these people.
    expect(EVENTS).not.toMatch(/roll (one |a |an )?(of your )?events? (up|into)/i);
  });

  it('counts events, not photographs or dates', () => {
    // The moment the line names an event it reads as a suggestion derived from
    // that event rather than from the people. The suggestion is one line above
    // a rule now rather than a card, and this survived the move.
    expect(FORM).toMatch(/\{cluster\.sharedEventCount\}/);
    expect(FORM).toMatch(/events'\} together/);
  });
});

/**
 * The way off the page, which for a while there was not one.
 *
 * `+` on Home or You asks the Groups tab to open this page, by way of a
 * counter — a counter rather than a flag because pressing `+` twice has to
 * open it twice. But the tab tree is drawn only while the route is `tabs`, so
 * pushing the page unmounts it, and Cancel mounted it again with the counter
 * still standing: the effect that reads it ran a second time and pushed the
 * page straight back over the tab it had just returned to.
 *
 * So Cancel did nothing, every time, and the page had no gesture either. The
 * only way out of a group somebody had decided not to make was to kill the app.
 */
describe('leaving without making one', () => {
  it('spends the request when it opens the page', () => {
    // Or the tab reopens it the moment the page closes, forever.
    expect(APP).toMatch(/setMakeGroup\(0\);\s*setRoute\(\{ screen: 'newGroup' \}\);/);
  });

  it('still opens again on the next press', () => {
    // Spending it must not disarm the `+`. The counter goes back up.
    expect(APP).toMatch(/setTab\('search'\);\s*setMakeGroup\(\(n\) => n \+ 1\);/);
    expect(EVENTS).toMatch(/if \(openCreate > 0\) onCreateGroup\(\);/);
  });

  it('has a Cancel and a gesture, not one or the other', () => {
    expect(PAGE).toMatch(/<Pressable onPress=\{onCancel\} hitSlop=\{12\}/);
    const at = APP.indexOf("route.screen === 'newGroup'");
    expect(APP.slice(at, at + 200)).toMatch(/<SwipeBack onBack=\{leaveToTabs\}>/);
  });
});

describe('New group', () => {
  it('is offered in every state, including the empty one', () => {
    /*
     * The web shipped this button only once you already had groups, which is
     * backwards — somebody with none is who most needs to know a group can be
     * made. The phone must not repeat it, so the guard is that the button's
     * condition does not mention the list's length.
     */
    /*
     * And the head is not drawn half-formed.
     *
     * The `+` used to be hidden while the groups were arriving, with an empty
     * disc holding its place — because the envelope beside it sits in a row
     * laid out from the right, so without the placeholder it was drawn where
     * the `+` belongs and slid left the moment the groups landed. A control
     * that is somewhere else for the first half-second is one somebody reaches
     * for and misses.
     *
     * The early return is what guarantees that now, and it is the stronger
     * version of the same rule: nothing on the tab is drawn — not the head,
     * not the controls — until every part of it can be drawn at once. So there
     * is no half-second in which a `+` could be missing from a row that has
     * already laid itself out.
     */
    expect(CHATS).toMatch(/if \(groups === null\) \{/);
    expect(CHATS.indexOf('if (groups === null)')).toBeLessThan(CHATS.indexOf('<PageHead'));
    expect(EVENTS).not.toMatch(/groups\.length > 0 && [\s\S]{0,80}New group/);
  });

  it('is the same `+` as Home and You', () => {
    /*
     * It made a group and only a group, because it is on the groups tab. That
     * is the reasoning that produces an app where one glyph means two things in
     * one place and one thing in another, which nobody can learn.
     */
    expect(EVENTS).toMatch(/onPress=\{\(\) => setStarting\(true\)\}[\s\S]{0,120}New album or group/);
    const tab = EVENTS.slice(EVENTS.indexOf('export function SearchTab'));
    expect(tab).toMatch(/<StartSomething/);
  });

  it('is a page of its own, not a form inside the list', () => {
    /*
     * It unfolded between the heading and the rooms, pushing them down — a form
     * the width of a list item with a keyboard over its bottom third, and the
     * thing it was part of still scrolling behind it.
     */
    expect(APP).toMatch(/screen: 'newGroup'/);
    expect(APP).toMatch(/<NewGroup/);
    // And only one of them, so a suggestion and a `+` cannot drift apart.
    expect(EVENTS).not.toMatch(/CreateGroupForm/);
    expect(FORM).not.toMatch(/export function CreateGroupForm/);
  });

  it('lands in the conversation, not on the group’s page', () => {
    /*
     * This used to go to the group's own screen, on the argument that the
     * next thing anybody wants is to put an event in it.
     *
     * A group is made to talk in. Its page is the roster, the albums and the
     * settings — the things somebody looks up later — and landing there after
     * creating one asks a person who has just decided to gather five friends
     * to find the way in.
     */
    expect(APP).toMatch(/const openMadeRoom = useCallback\(/);
    expect(APP).toMatch(
      /group\s*\?\s*\{ screen: 'groupThread', group: \{ \.\.\.group, name: group\.title \} \}\s*:\s*\{ screen: 'group', id \},/,
    );
    /*
     * One callback for both screens that make a room. They ask different
     * questions — a chat asks who, a group asks who and what it is called —
     * and what happens after is the same in both: the list behind is stale,
     * and the person who just made it wants to be inside it.
     */
    expect(APP.match(/onCreated=\{openMadeRoom\}/g) ?? []).toHaveLength(2);
  });

  it('falls back to the page it used to go to', () => {
    /*
     * The chat screen wants the group rather than its id, so the handler
     * reads the detailed list back — the same request the Chats tab makes on
     * arrival, and the group is certainly in it. A failure is survivable
     * because the old destination is a worse answer rather than a wrong one.
     */
    expect(APP).toMatch(/\.myGroupsDetailed\(\)/);
    expect(APP).toMatch(/groups\.find\(\(g\) => g\.id === id\) \?\? null/);
  });

  it('can add somebody the suggestions never mentioned', () => {
    /*
     * The card offered a cluster's people and the handful it came with, and
     * nobody else — so a group with one person in it who had never been at an
     * event with you could not be made from this screen at all.
     */
    expect(PAGE).toMatch(/<InvitePicker/);
  });
});

/**
 * A chat is people and nothing else.
 *
 * The `+` on the Chats tab used to change tabs to Find and open the group
 * form there — a button on the conversations tab that moved somebody
 * somewhere else and then asked them for a title. Almost no conversation is
 * a standing arrangement on the day it starts, and asking for a name up front
 * made every one of them a small act of administration before it was a chat.
 */
describe('making a chat', () => {
  it('asks who, and asks nothing else', () => {
    // No field, not even an optional one: an optional field is still a
    // question, and the question is what this screen stopped asking.
    expect(PAGE).toMatch(/\{!chat && \(/);
    expect(PAGE).toMatch(/chat \? 'New chat' : 'New group'/);
    expect(PAGE).toMatch(/chat \? 'WHO ARE YOU TALKING TO' : 'ADD FRIENDS'/);
  });

  it('never says group on the screen that makes a chat', () => {
    /*
     * The words on this page are picked by `chat`, so the test is that no
     * sentence reaches a chat with "group" in it — which is a claim about the
     * branches rather than about the file, since the same file still draws
     * the group form.
     */
    const chatSide = (PAGE.match(/chat\s*\n?\s*\?[^:]+/g) ?? []).join('\n');
    expect(chatSide).not.toMatch(/group/i);
  });

  it('is ready when somebody is picked, where a group is ready when named', () => {
    // A group needs a name — that is what somebody came to give it. A chat
    // needs a person: a conversation with nobody is a room, which is the
    // thing this screen is deliberately not making.
    expect(PAGE).toMatch(/const ready = chat \? picked\.length > 0 : name\.trim\(\)\.length > 0;/);
  });

  it('is reached from the tab it belongs to, not by changing tabs', () => {
    expect(APP).toMatch(/onCreateChat=\{\(\) => setRoute\(\{ screen: 'newChat' \}\)\}/);
    expect(APP).toMatch(/kind="chat"/);
    expect(APP).toMatch(/kind="group"/);
    // And a chat never arrives holding a cluster or a suggested name: it has
    // no name to suggest.
    expect(APP).toMatch(/\| \{ screen: 'newChat' \}/);
  });
});

/**
 * What a room is called when nobody has called it anything.
 *
 * One rule, on the server, sent down as `title` — the derivation has three
 * branches and two clients drawing from it, and written twice it would be two
 * products within a release.
 */
describe('a room with no name', () => {
  const GROUPS = readFileSync(
    fileURLToPath(new URL('../../web/src/groups.ts', import.meta.url).href),
    'utf8',
  );

  it('is called after the one other person, and is not a group', () => {
    expect(GROUPS).toMatch(/if \(others\.length === 1\) return \{ title: others\[0\]!\.name, kind: 'direct' \};/);
  });

  it('is called after two of them and a count when there are more', () => {
    // Two names because that is how somebody says it out loud, and the third
    // is where a sentence becomes a membership list.
    expect(GROUPS).toMatch(/export const CHAT_NAMES_SHOWN = 2;/);
    expect(GROUPS).toMatch(/rest > 0 \? `\$\{named\.join\(', '\)\} \+ \$\{rest\} more` : named\.join\(', '\)/);
  });

  it('never counts the person reading it', () => {
    // Their own name in the title of their own chat is the screen describing
    // them to themselves, and on a two-person chat it would say two names
    // where one is the point.
    expect(GROUPS).toMatch(/if \(row\.actorId === viewerId\) continue;/);
  });

  it('keeps a conversation off the shelf of groups', () => {
    expect(EVENTS).toMatch(/\(mine \?\? \[\]\)\.filter\(\(group\) => group\.kind !== 'direct'\)/);
  });

  it('wears the people in it where a named room wears a letter', () => {
    const mark = EVENTS.slice(
      EVENTS.indexOf('function RoomMark'),
      EVENTS.indexOf('function ConversationLine'),
    );
    expect(mark).toMatch(/room\.kind === 'named' \|\| room\.deck\.length === 0/);
    // Squares, because it stands exactly where the lens tile stood and a
    // circle there would make the unnamed rooms read as a different kind of
    // row rather than the same row drawn from what it has.
    expect(mark).toMatch(/borderRadius: Math\.round\(card \* 0\.25\)/);
    // And the deck is the members' own portraits, which the server only ever
    // builds for a room the reader is in.
    expect(GROUPS).toMatch(/export async function deckFor\(/);
  });

  it('can be named later, and a two-person chat cannot', () => {
    const ROUTE = readFileSync(
      fileURLToPath(new URL('../../web/app/api/groups/[id]/route.ts', import.meta.url).href),
      'utf8',
    );
    expect(ROUTE).toMatch(/export async function PATCH\(/);
    expect(ROUTE).toMatch(/chat_not_nameable/);
    // Clearing it writes null and not '', which is what puts the room back to
    // being called after its people.
    expect(ROUTE).toMatch(/\{ name: null, slug: null, findable: false \}/);
    expect(read('src/Groups.tsx')).toMatch(/nameable=\{group\.memberCount > 2\}/);
  });
});
