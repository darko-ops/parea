/**
 * Groups has a page, and the rules about it that look like omissions.
 *
 * **Groups are created here now, and the guard changed shape rather than
 * going away.** This page used to assert that no create button existed, and
 * the reasoning was that a group is noticed afterwards: an empty group you
 * then have to fill is a distribution problem with no photographs in it. What
 * reversed it is not a change of mind about that but the clusters — the people
 * the actor already keeps ending up in the same events as. So what is asserted
 * now is the thing that makes creation safe: the page may not offer creation
 * *without* showing who it would be with, the cluster cards must write nothing
 * until Create, and a cluster must never reach somebody who was not there.
 *
 * That last one is the privacy boundary and is tested against a real database
 * in `clusters.test.ts`, where it can be proven rather than pattern-matched.
 * What is here is the page-level half: the data only ever comes from the
 * server's own per-actor query.
 *
 * **A group never shows a photograph.** It has no cover of its own, and the
 * only pictures available are inside events that belong to it — putting one on
 * the door means a photograph from a room appears on the screen that is merely
 * the way into it, including for somebody who has since been removed. The tile
 * is a letter in a lens colour, as it is on the search page.
 *
 * Source checks because there is no DOM in this suite; they stand in for the
 * browser run that confirmed the page against real groups.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const read = async (path: string) =>
  stripComments(await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const PAGE = await read('../app/groups/page.tsx');
const RAIL = await read('../app/components/Rail.tsx');
const API = await read('../app/api/groups/route.ts');
const GROUP = await read('../app/components/GroupView.tsx');
const CARD = await read('../app/components/CreateGroupCard.tsx');
const EVENTS = await read('../../mobile/src/Events.tsx');
const CHATS = await read('../app/components/GroupChats.tsx');
const FIND = await read('../app/components/FindView.tsx');
const SCREEN = await read('../app/components/GroupChatScreen.tsx');
const THREAD = await read('../app/components/Thread.tsx');
const CHAT_PAGE = await read('../app/group/[id]/chat/page.tsx');
const FIND_PAGE = await read('../app/find/page.tsx');
const GROUPS_SRC = await read('../src/groups.ts');
const GROUP_PAGE = await read('../app/group/[id]/page.tsx');
const MARK = await read('../app/components/RoomMark.tsx');
const SAYER = await read('../app/components/PersonFace.tsx');
const VIEW = await read('../app/components/ChatView.tsx');
const SEARCH = await read('../app/components/SearchControl.tsx');
const HOME_VIEW = await read('../app/components/HomeView.tsx');
/*
 * Raw, not comment-stripped, because the thing being asserted *is* a comment:
 * the rule about tiles and photographs lives beside the class it governs, and
 * `stripComments` would delete the evidence.
 */
const CSS = await readFile(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

describe('where a group comes from', () => {
  it('can still be an event, and can now be people', () => {
    // Both paths, because the roll-up is what the event screen and the native
    // client still call. Losing it would break creation everywhere else.
    expect(API).toMatch(/fromEventId/);
    expect(API).toMatch(/event_required/);
    expect(API).toMatch(/memberIds/);
  });

  it('leads with who, before it offers to make anything — on Find', () => {
    /*
     * The whole argument in one assertion, and it has moved pages. A create
     * control that appears without the people it would be made from is the
     * empty-room failure the original design refused outright, so the clusters
     * have to be read and the primary card has to be one of them.
     *
     * They are on Find now. Chat is the conversations: the cards sat under the
     * chat list as "these people keep turning up too", which made a page whose
     * whole subject is conversations two thirds a groups directory. Making a
     * group belongs where the groups are, which is also where the app makes
     * one.
     */
    expect(FIND_PAGE).toMatch(/recurringClusters\(db, actorId\)/);
    expect(FIND).toMatch(/The same people keep turning up/);
    expect(FIND).toMatch(/<CreateGroupCard/);
    expect(FIND).toMatch(/primary=\{i === 0\}/);
    // And nowhere else: two pages offering to make the same group out of the
    // same people is the directory growing back. The element rather than the
    // word — `NewGroupPanel` is exported from that file and the `+` still
    // opens it.
    expect(PAGE).not.toMatch(/<CreateGroupCard|recurringClusters/);
  });

  it('is the conversations and nothing else', () => {
    /*
     * What was under the chat list: the cluster cards, each a stack of faces
     * and a `Make a group`, and under those a line about finding groups you
     * are not in. Both are the groups directory, and the conversations were
     * the part you scrolled past to reach it.
     */
    for (const furniture of ['clusters-also', 'groups-foot', '<CreateGroupCard']) {
      expect(PAGE, `${furniture} belongs on Find`).not.toContain(furniture);
    }
    // The list is drawn through `ChatView`, which holds the one query the head
    // and the rows share. The page still renders nothing else.
    expect(PAGE).toMatch(/<ChatView/);
    expect(VIEW).toMatch(/<GroupChats/);
  });

  it('never says the clusters are groups', () => {
    /*
     * They are recurring sets of people until somebody presses something.
     * Asserting the rejected copy stays rejected: counting them, or calling
     * them groups the person already has, is presumptuous about a relationship
     * the product inferred rather than was told about.
     */
    expect(PAGE).not.toMatch(/you already have|unnamed groups|your groups are/i);
    // And the vocabulary the ticket dropped entirely: nobody has to learn a
    // second word for making a group with these people.
    expect(PAGE).not.toMatch(/roll (one |a |an )?(of your )?events? (up|into)/i);
  });

  it('asks the server for clusters and never derives them in the browser', () => {
    // They are computed per actor from events that actor was in. A client that
    // assembled them would need everybody else's participation to do it.
    expect(CARD).not.toMatch(/event_participant|participants|recurringClusters/);
  });

  it('writes nothing until Create', () => {
    /*
     * The property that makes suggesting a set of people acceptable rather
     * than presumptuous: opening the form, removing a chip and walking away
     * must all be free. Exactly one call in the component, and it is the one
     * behind the button.
     */
    const calls = CARD.match(/fetch\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(CARD).toMatch(/fetch\('\/api\/groups', \{[\s\S]*?method: 'POST'/);
  });

  it('says what pressing Create does to other people, above the button', () => {
    /*
     * Creating from people writes memberships rather than invitations, which
     * is a real thing to do to somebody. The sentence saying so has to be read
     * before the decision — so it is in the instruction above the chips, and
     * the order is what is asserted.
     */
    const consent = CARD.indexOf('They are told when the group is made');
    const button = CARD.indexOf('Create group');
    expect(consent).toBeGreaterThan(-1);
    expect(consent).toBeLessThan(button);
  });

  it('offers creation from scratch in every state, including the empty one', () => {
    /*
     * This was a sentence with a link in it, below the clusters, and only on
     * the empty page — while the actual button appeared once you already had
     * groups. That is backwards, and the page read as offering a suggestion
     * and no way to make anything: reported from use.
     *
     * So the panel is unconditional, which is the assertion. A regression here
     * looks like the `+` being moved back inside a branch.
     *
     * No `also` on it now. That list was "add somebody who was not at those
     * events", which only means anything beside a cluster — there is nothing
     * for it to be *also* to in a blank form, and the clusters are on Find.
     */
    expect(VIEW).toMatch(/<NewGroupPanel/);
    expect(VIEW).not.toMatch(/length > 0 && <NewGroupPanel/);
    expect(PAGE).not.toMatch(/groups\.length > 0 && <ChatView/);
    expect(CARD).toMatch(/aria-label="New group"/);
  });

  it('still says where chats come from when there is nothing to recognise', () => {
    /*
     * A new account sees no clusters, and the page must not read as broken.
     * It leads with what is missing — the page answering its own heading —
     * and then with the question this page invites and cannot otherwise
     * answer: where the *other* kind of conversation went, which is onto the
     * photograph it is about, and into Notifications when somebody replies.
     */
    expect(PAGE).toMatch(/No chats yet\./);
    expect(PAGE).toMatch(/Comments on a photograph live/);
    expect(PAGE).toMatch(/href="\/activity"/);
    expect(PAGE).toMatch(/href="\/events"/);
  });
});

describe('what a row shows', () => {
  it('draws the tile from the room itself, never a photograph out of it', () => {
    /*
     * This assertion has narrowed twice, and each time to its actual reason.
     *
     * It began as "nothing on this page may be an image". Then as "the tile is
     * a letter in a lens colour on every screen" — which was still broader
     * than the reason, and the reason is about *the door*: the search page's
     * group card, where the viewer may not be a member and a picture borrowed
     * out of an album would show a room to somebody outside it.
     *
     * A member's own portrait is not a picture out of the room. It is theirs,
     * it is already on their profile, and `deckFor` only ever builds this list
     * for a room the viewer is in. So an unnamed room — one with no name and
     * therefore no letter to wear — is drawn as the people in it, which is
     * what the app has always done and what this page was missing.
     *
     * What survives, and is the part that was always load-bearing: the mark
     * stands for the group rather than for anything *inside* it. No cover, no
     * photograph out of an album, on any screen a group appears on.
     */
    expect(CHATS).toMatch(/<RoomMark/);
    expect(CHATS).not.toMatch(/cover/i);
    // Its own picture, else its people — named or not — else its letter.
    expect(MARK).not.toMatch(/kind === 'named'/);
    expect(MARK.indexOf('if (photoUrl)')).toBeGreaterThan(-1);
    expect(MARK.indexOf('if (photoUrl)')).toBeLessThan(MARK.indexOf('if (cards.length === 0)'));
    expect(MARK).toMatch(/className=\{`group-tile \$\{className\}`\.trim\(\)\}/);
    expect(MARK).toMatch(/initialOf\(title\)/);
    // And the pictures it may draw are the members', never an album's.
    expect(MARK).toMatch(/person\.avatarUrl/);
    // `objectFit: 'cover'` is how the room's own picture fills its square,
    // not an album cover; anything else by that name is.
    expect(MARK.replace(/objectFit: 'cover'/g, '')).not.toMatch(/cover|event/i);
    // The group's own screen is untouched: it is a letter there as before.
    const headTile = GROUP.match(/className="group-tile group-head-tile"[\s\S]*?<\/span>/)?.[0] ?? '';
    expect(headTile).not.toBe('');
    expect(headTile).not.toMatch(/<img|<Face/);
  });

  it('wears the same mark in the list and at the top of the chat', () => {
    /*
     * Without this the header drew a letter for every room, so an unnamed
     * group was three faces in the list and a grey initial the moment somebody
     * opened it — the same room, twice, differently.
     */
    expect(SCREEN).toMatch(/<RoomMark/);
    expect(SCREEN).not.toMatch(/group\.name\.trim\(\)\.slice\(0, 1\)/);
    // Fed from one query rather than by asking for the title and the members
    // separately. See `roomOf`.
    expect(CHAT_PAGE).toMatch(/roomOf\(db, group, actorId\)/);
    expect(GROUPS_SRC).toMatch(/export async function roomOf/);
  });

  it('shows who spoke last as their name in bold, with no face beside it', () => {
    /*
     * It was their picture, and their initial on a lens colour before that.
     * The row's own icon already says which room this is, and a second,
     * smaller mark beside the line said less than the name it sat next to —
     * so the line leads with the name, in bold, on both clients.
     */
    const line = CHATS.slice(CHATS.indexOf('chat.last ?'), CHATS.indexOf('Nobody has said anything yet.'));
    expect(line).not.toMatch(/<PersonFace/);
    expect(line).toMatch(/<span className="chat-sayer">/);
    expect(CSS).toMatch(/\.chat-sayer \{ font-weight: 700;/);
    const phone = EVENTS.slice(EVENTS.indexOf('function ConversationLine'), EVENTS.indexOf('function ConversationLine') + 3000);
    expect(phone).not.toMatch(/sayerFace/);
    expect(phone).toMatch(/<Text style=\{\[styles\.sayer, \{ color: t\.fg \}\]\}>/);
    expect(EVENTS).toMatch(/sayer: \{ fontWeight: '700' \},/);
  });

  it('says which screen the no-photograph rule governs', () => {
    // The comment was broad enough to read as forbidding the cover strip this
    // page now has. Left as it was, the next person finds an apparent
    // contradiction and has to guess which half is stale.
    const rule = CSS.slice(CSS.indexOf('.group-tile {') - 900, CSS.indexOf('.group-tile {'));
    expect(rule).toMatch(/door/i);
  });

  it('is a conversation, not a room', () => {
    /*
     * What a row was: a name, a stack of faces, "4 albums · 12 people · added
     * to 2 days ago", three covers, a `View all`, and — last — one line of
     * what anybody had said. Two hundred pixels a group, so three filled a
     * laptop screen and the talking was under the furniture. The app reached
     * the same page and made the same cut; this asserts the cut stays made.
     *
     * The room is not gone, it is one press away: a row opens the conversation
     * on a screen of its own and the bar at the top of it goes to the room.
     *
     * It was `?tab=chat`, which is the room — crest, three tabs, its albums —
     * showing the Chat pane, so a list of conversations opened a page about a
     * group with the talking inside it. Asserted as an absence too, because
     * that URL still works and is still what the room's own tab uses.
     */
    expect(CHATS).toMatch(/\/chat`/);
    expect(CHATS).not.toMatch(/\?tab=chat/);
    expect(CHATS).toMatch(/chat\.last\.body/);
    expect(CHATS).toMatch(/Nobody has said anything yet\./);
    for (const furniture of ['group-strip', 'GroupCover', 'View all', 'group-meta', '<Face']) {
      expect(PAGE, `${furniture} is the room, not the chat`).not.toContain(furniture);
      expect(CHATS, `${furniture} is the room, not the chat`).not.toContain(furniture);
    }
  });

  it('opens the conversation on a screen of its own', () => {
    /*
     * The screen is a bar and a thread and nothing else — no crest over three
     * tabs, no shelf of albums under it. Both it and the room's Chat tab draw
     * the same `GroupChat`, which is the point of that being a component
     * rather than a page: one conversation, two places it can be reached from.
     *
     * The bar is the way into the room, and the whole block is the link. A
     * separate button beside the name is the shape that asks somebody to
     * notice a second control.
     */
    expect(SCREEN).toMatch(/<GroupChat groupId=\{group\.id\} \/>/);
    expect(SCREEN).toMatch(/href=\{`\/group\/\$\{group\.id\}`\}/);
    expect(SCREEN).not.toMatch(/event-tabs|group-shelf|GroupView/);
    // Members only. A non-member gets the 404 a nonexistent group gets rather
    // than the door — the door is `/group/<id>`, and a conversation has no
    // such state to draw.
    expect(CHAT_PAGE).toMatch(/if \(!membership\) notFound\(\);/);
  });

  it('asks a room\u2019s question in a room, not a roll\u2019s', () => {
    /*
     * An empty board sits under a wall of photographs somebody has just
     * scrolled, and the thing to say is about those. A group's chat has no
     * photographs in front of it: it is a room with nobody talking in it, and
     * the nudge is social.
     *
     * The branch is the app's and it was missing here — the album's sentence
     * was drawn in both places, so an empty group chat invited somebody to say
     * something about photographs that were not on the screen.
     */
    expect(THREAD).toMatch(/room\.kind === 'group'/);
    expect(THREAD).toMatch(/Say something before this gets awkward\./);
    expect(THREAD).toMatch(/Go on, say what everyone’s thinking\./);
  });

  it('orders by the last thing said, and lists the silent rooms anyway', () => {
    /*
     * Not `lastActiveAt`, which is when an album in the room was last added
     * to — the other page's subject. Sorting a chat list by it puts a room
     * full of photographs and no conversation above the one two people are
     * talking in.
     *
     * Sorted on the server so the order is in the HTML a reader gets before
     * any script runs, and a group with nothing said in it sorts last rather
     * than being dropped: a silent room is one somebody might be the first to
     * speak in.
     */
    expect(PAGE).toMatch(/\.sort\(\(a, b\) => \(b\.lastMessage\?\.at \?\? ''\)/);
    expect(PAGE).not.toMatch(/lastActiveAt/);
    expect(PAGE).not.toMatch(/filter\([^)]*lastMessage/);
  });

  it('searches what was said, not only what the rooms are called', () => {
    // On a page that is only conversations, somebody is as likely to remember
    // a word out of one as the name of the room it happened in. Local, because
    // everything is already in the props: the list narrows while you type.
    expect(CHATS).toMatch(/chat\.name, chat\.last\?\.body, chat\.last\?\.author/);
    expect(CHATS).toMatch(/'use client'/);
  });

  it('words its times on the server', () => {
    // Two clocks disagree, and React answers a text mismatch by throwing the
    // tree away — the same rule every other relative time here follows.
    expect(PAGE).toMatch(/function ago/);
    expect(PAGE).toMatch(/RelativeTimeFormat/);
  });
});

describe('what a non-member is handed', () => {
  it('is nothing from inside the group', () => {
    /*
     * Not fetched-and-hidden. The door has to be *unable* to leak rather than
     * merely choosing not to: a later change to the component cannot disclose
     * what the page never put in its props. `findable` promises a name and a
     * size, and that is all this branch is given.
     */
    expect(GROUP_PAGE).toMatch(/membership\s*&&\s*since/);
    expect(GROUP_PAGE).toMatch(/:\s*\[\[\], \[\]\]/);
  });

  it('keeps the door\u2019s words exactly', () => {
    // The one sentence that explains why somebody can see a name and not the
    // photographs. It is the product's access model said out loud.
    expect(GROUP).toContain(
      'You can see that this group exists. You cannot see its photos',
    );
    expect(GROUP).toContain('Asked to join. Someone who runs this group will decide.');
    expect(GROUP).toMatch(/canJoinDirectly \? 'Join' : 'Ask to join'/);
  });

  it('draws no faces, covers or event count on the door', () => {
    const door = GROUP.slice(
      GROUP.indexOf('if (!group.member)'),
      GROUP.indexOf('const hrefFor'),
    );
    expect(door).not.toBe('');
    expect(door).not.toMatch(/<Face|shelf-|EventCover|events\.length/);
    /* And no tabs either: a door has no albums, no conversation and no list of
       people, so it does not draw three that would all be empty. */
    expect(door).not.toMatch(/event-tabs|GroupChat/);
  });
});

describe('inside a group', () => {
  it('measures the room in rolls and age, not in members', () => {
    /*
     * The app's own line, and the two halves of it are a decision each. The
     * member count was the first half: eleven faces with names under them is
     * what "11 people" stood in for, and they are one tab away on the pane
     * that is about exactly that. What a count cannot say is *since March
     * 2024*, and a group's age is most of what makes it read as a room rather
     * than as a list.
     *
     * `· you run this` went with it. An admin is told by the things only an
     * admin is shown — the Invite slot beside the faces — not by a clause on
     * a line about how big the room is.
     */
    const meta = GROUP.slice(GROUP.indexOf('group-head-meta'), GROUP.indexOf('group-actions'));
    expect(meta).not.toBe('');
    expect(meta).toMatch(/group\.events\.length/);
    expect(meta).toMatch(/since \$\{group\.since\}/);
    expect(meta).not.toMatch(/memberCount|you run this/);
    // Worded on the server, like every date here: a browser's clock and the
    // server's disagree, and React answers a text mismatch by discarding the
    // tree. And withheld at the door, which is told a name and a size only.
    expect(GROUP_PAGE).toMatch(/since: membership \? MONTH\.format\(group\.createdAt\) : null/);
  });

  it('puts the one thing the room does on the tab row', () => {
    /*
     * `New album here` was a filled accent pill in the head, beside the name.
     * The head is the room's identity and a button in it competes with the
     * name for the line — and the word was the only type on the screen
     * claiming what pressing it does, where the `+` everywhere else says the
     * same thing in a glyph. The app puts it at the end of the tab row, which
     * is where the album screen puts its own.
     */
    const row = GROUP.slice(GROUP.indexOf('group-tabrow'), GROUP.indexOf('group-create'));
    expect(row).not.toBe('');
    expect(row).toMatch(/className="round group-new"/);
    expect(row).toMatch(/aria-label="New roll in this group"/);
    // The word is gone from the button and nowhere else in the page picked it
    // up — two create controls with different labels is the drift this stops.
    expect(GROUP).not.toContain('New roll here');
    const head = GROUP.slice(GROUP.indexOf('<header className="group-head">'), GROUP.indexOf('group-tabrow'));
    expect(head).not.toMatch(/group-new/);
  });

  it('answers an empty room with a sentence, not a second button', () => {
    /*
     * There was a button under "Nothing yet.", on the argument that with no
     * shelf, making one *is* the page. That was right while the control was
     * up in the head; the `+` is pinned in the tab row directly above this
     * card now, so a second one is two buttons for one action eighteen pixels
     * apart. What the sentence does instead is say what will happen here, and
     * that everyone finds out when it does.
     */
    const empty = GROUP.slice(GROUP.indexOf('className="group-empty"'), GROUP.indexOf('group-shelf'));
    expect(empty).not.toBe('');
    expect(empty).toMatch(/The next roll anybody makes in this group shows up/);
    expect(empty).not.toMatch(/<button/);
  });

  it('shows an admin who is waiting, on the pane about people', () => {
    /*
     * The API to approve and decline has existed since this page did, and only
     * the phone ever drew it — so a request made from search was answerable on
     * one client and invisible on the other.
     *
     * On the People pane rather than above the albums, which is where the app
     * had it and moved it from: an admin meeting a queue on the way to the
     * photographs is being asked about a person while looking at something
     * else. The tab carries the count so nobody has to open it to find out
     * there is nothing there, which is what it holds almost every day.
     */
    const pane = GROUP.slice(GROUP.indexOf("tab === 'people'"), GROUP.indexOf('people-strip'));
    expect(pane).toMatch(/join-queue/);
    expect(pane).toMatch(/waiting to join/);
    expect(GROUP).toMatch(/id === 'people' && queue\.length > 0/);
    expect(GROUP).toMatch(/event-tab-count/);
  });

  it('hands a member nothing to draw, rather than hiding it from them', () => {
    /*
     * That a particular stranger is trying to get into this room is the
     * admin's to know. Not fetched-and-hidden, for the reason the door is not:
     * a later change to the component cannot disclose what the page never put
     * in its props — and `openJoinRequests` deliberately has no permission
     * check of its own, because a function that quietly returns nothing for
     * the wrong reader hides a missing check rather than failing it.
     */
    expect(GROUP_PAGE).toMatch(
      /membership\?\.role === 'admin' \? await openJoinRequests\(db, group\.id\) : \[\]/,
    );
    const fn = GROUPS_SRC.slice(GROUPS_SRC.indexOf('export async function openJoinRequests'));
    expect(fn.slice(0, fn.indexOf('\n}'))).not.toMatch(/membership|role/);
  });

  it('never links to the person asking', () => {
    /*
     * A request to join is answered on what the group already knows about
     * whoever is asking. A link to a stranger's page turns answering into
     * looking somebody up, which is a different decision made on different
     * information — so the row carries a display name and no handle, and the
     * query does not select one.
     */
    const queue = GROUP.slice(GROUP.indexOf('join-queue-head'), GROUP.indexOf('join-queue-note'));
    expect(queue).not.toBe('');
    expect(queue).not.toMatch(/<a |href=/);
    const query = GROUPS_SRC.slice(
      GROUPS_SRC.indexOf('export async function openJoinRequests'),
      GROUPS_SRC.indexOf('export async function groupPeople'),
    );
    expect(query).not.toMatch(/handle/);
  });

  it('takes the row away after the server answers, not before', () => {
    /*
     * An optimistic removal takes somebody off the screen and leaves them
     * waiting if the call failed — the one outcome an admin would never find
     * out about. So the filter is after the `res.ok` guard, and a failure
     * leaves the row where it is with the error above it.
     */
    const answer = GROUP.slice(GROUP.indexOf('const answer = useCallback'), GROUP.indexOf('const join'));
    expect(answer).not.toBe('');
    expect(answer.indexOf('if (!res.ok)')).toBeLessThan(answer.indexOf('setQueue('));
    // And a refresh only where something else on the screen changed: approving
    // writes a membership, so the faces below are now wrong. Declining is
    // invisible everywhere but this row.
    expect(answer).toMatch(/if \(action === 'approve'\) router\.refresh\(\)/);
  });

  it('does not open with the create form', () => {
    // A room whose premise is that something already happened here began by
    // asking you to type. The form is behind a header button now.
    const head = GROUP.indexOf('group-head-row') > -1 ? -1 : GROUP.indexOf('<header className="group-head">');
    const form = GROUP.indexOf('<form className="group-create"');
    expect(head).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(head);
  });

  it('puts leaving in the menu, not loose in the page', () => {
    // A destructive action at the foot of a screen is one somebody presses
    // while reaching for something else.
    expect(GROUP).toMatch(/menu-danger[\s\S]{0,400}Leave this group/);
    // And not as a bare control in the page, which is where it was.
    expect(GROUP).not.toMatch(/className="secondary"[\s\S]{0,200}Leave this group/);
  });

  it('says what leaving costs, which is what makes hiding it safe', () => {
    expect(GROUP).toContain('Photos live in the rolls, not in the group.');
  });

  it('words its dates on the server', () => {
    /*
     * A date computed in the browser can disagree with the HTML it is
     * hydrating, and React answers that by throwing the tree away.
     *
     * The month headings that used to be worded here went with the rows they
     * headed: every tile on the shelf carries its own date, which is what
     * they were saying.
     */
    expect(GROUP_PAGE).toMatch(/dates: Object\.fromEntries\(/);
    expect(GROUP_PAGE).not.toMatch(/function monthOf/);
    expect(GROUP).not.toMatch(/toLocaleDateString|new Intl\.DateTimeFormat/);
  });

  it('is shaped like a roll: three tabs, and the URL says which', async () => {
    /*
     * A room and an evening are the same kind of object to somebody reading —
     * a thing with pictures in it, a conversation about them, and the people
     * it belongs to. `?tab=` rather than state, for the reason the album's
     * three use it: a link to the room's people is a link somebody can send,
     * and Back is the way out of it.
     */
    expect(GROUP).toMatch(/const TABS: \[GroupTab, string, RailGlyph\]\[\] = \[/);
    expect(GROUP).toMatch(/\['albums', 'Rolls', 'photos'\]/);
    expect(GROUP).toMatch(/\['chat', 'Chat', 'bubbles'\]/);
    expect(GROUP).toMatch(/\['people', 'People', 'groups'\]/);
    /*
     * The app's own drawings beside the words. Two bubbles for a room where
     * people are talking to each other, against the single bubble an album's
     * comments carry — the distinction the app checked survives at the size
     * both clients draw them.
     */
    expect(GROUP).toMatch(/<RailIcon glyph=\{glyph\} weight=\{tab === id \? 2\.5 : 2\} \/>/);
    const EVENT = await read('../app/components/EventView.tsx');
    expect(EVENT).toMatch(/\['conversation', 'Thread', 'bubble'\]/);
    const ICONS = await read('../app/components/RailIcon.tsx');
    for (const glyph of ['photos', 'bubble', 'bubbles']) {
      expect(ICONS, glyph).toMatch(new RegExp(`glyph === '${glyph}'`));
    }
    expect(GROUP).toMatch(/className="event-tabs"/);
    expect(GROUP_PAGE).toMatch(
      /const tab: GroupTab = asked === 'chat' \|\| asked === 'people' \? asked : 'albums';/,
    );
    // Anything unrecognised falls to the albums rather than 404ing: a stale
    // `?tab=archive` in somebody's history should open the room, not refuse it.
    expect(GROUP_PAGE).toMatch(/searchParams: Promise<\{ tab\?: string \}>;/);
  });

  it('shelves rolls two across rather than as a month-by-month archive', () => {
    /*
     * A row per album with a 180px cover, name, date, faces and counts, under
     * month headings, was a third way of drawing the same object — next to
     * the cards on the home page and the shelf in the app. Cover, name, date
     * is what a shelf shows.
     */
    expect(GROUP).toMatch(/className="group-shelf"/);
    expect(GROUP).toMatch(/className="shelf-album"/);
    expect(GROUP).not.toMatch(/group-month|archive-row|group\.months/);
    expect(CSS).toMatch(/\.group-shelf \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(200px, 1fr\)\)/);
    // What a room knows that a person's shelf does not.
    expect(GROUP).toMatch(/className="shelf-pip"/);
  });

  it('holds the group’s conversation rather than having none', async () => {
    /*
     * The site had no way into a group's thread at all — the room existed,
     * the endpoint existed, and nothing drew it. `Thread` takes a room now
     * rather than an event id, which is what let one component serve both.
     */
    const CHAT = await read('../app/components/GroupChat.tsx');
    const THREAD = await read('../app/components/Thread.tsx');
    expect(GROUP).toMatch(/\{tab === 'chat' && <GroupChat groupId=\{group\.id\} \/>\}/);
    expect(THREAD).toMatch(/export type ThreadRoom =/);
    expect(THREAD).toMatch(/room\.kind === 'group'\s*\?\s*`\/api\/groups\/\$\{room\.id\}\/messages`/);
    expect(THREAD).toMatch(/room\.kind === 'group' \? `\/api\/group-messages\/\$\{id\}` : `\/api\/messages\/\$\{id\}`/);
    expect(CHAT).toMatch(/room=\{\{ kind: 'group', id: groupId \}\}/);
    // Polled, because a group has no feed to fold the thread into — and only
    // while the tab is in front.
    expect(CHAT).toMatch(/document\.visibilityState === 'visible'/);
    expect(CHAT).toMatch(/setInterval\(tick, 4000\)/);
  });

  it('never prints a raw date string', () => {
    // What it did: `2025-09-12` beside an event name.
    expect(GROUP).not.toMatch(/event\.eventDate/);
  });

  it('dates a roll by when it was made', async () => {
    /*
     * `groupArchive` dated one by the host's own event date, falling back to
     * when it was last added to — and said explicitly "never `created_at`,
     * which is when somebody made the page". Reversed, and asked for: a shelf
     * is read as a list of things that were started, and dating albums by the
     * evenings they are about made a group's shelf and a person's disagree
     * with the card on the home page, which has led with `created_at` since it
     * stopped leading with a photograph's timestamp.
     */
    const GROUPS_SRC = await read('../src/groups.ts');
    expect(GROUPS_SRC).toMatch(/at: row\.createdAt\.toISOString\(\),/);
    expect(GROUPS_SRC).not.toMatch(/at: \(row\.eventDate/);
    // The same rule on both profiles, which is where it was asked about.
    expect(await read('../app/components/AccountView.tsx')).toMatch(
      /date: dateLabel\(event\.createdAt\),/,
    );
    expect(await read('../app/u/[handle]/page.tsx')).toMatch(/date: dateLabel\(album\.createdAt\),/);
    expect(await read('../src/people.ts')).toMatch(/createdAt: row\.createdAt\.toISOString\(\),/);
  });
});

describe('the rail', () => {
  it('puts Chat between Find and Notifications', () => {
    /*
     * Home, Find, Chat, Notifications, You: what you have, then the way
     * to more of it, then the rooms, then what has happened to you, then you.
     *
     * It ran Home, Notifications, Chat, Find, on the argument that the
     * rows descend from what has already happened to you toward what you are
     * not part of yet. That is a true sentence about the rows and the wrong
     * axis to sort them on — Find is how this product is used, not the far end
     * of it, and it was fourth.
     *
     * Matched on `page`, which is what the code calls them and what has not
     * moved: a relabelling should not be able to fail this, and a reordering
     * is what it is for.
     */
    const at = (page: string) => RAIL.indexOf(`page: '${page}'`);
    expect(at('groups')).toBeGreaterThan(-1);
    expect(at('find')).toBeLessThan(at('groups'));
    expect(at('groups')).toBeLessThan(at('invites'));
  });

  it('does not wear the logo as a nav glyph', async () => {
    // Three overlapping circles is the mark. A row drawn with it reads as "go
    // to Parea" rather than as a section, and the rail already has the mark at
    // the top of it.
    const icons = await read('../app/components/RailIcon.tsx');
    const groups = icons.slice(icons.indexOf("glyph === 'groups'"), icons.indexOf("glyph === 'search'"));
    expect(groups).not.toBe('');
    expect((groups.match(/<circle/g) ?? []).length).toBeLessThan(3);
  });
});

describe('the search, which is a disc until it is asked for', () => {
  it('is a button in the leading corner, not a field above the list', () => {
    /*
     * The page argued the other way and the argument was written down: a
     * permanent field, because it was the only control here and the list under
     * it is what it acts on.
     *
     * What that left out is the cost, which the app had already paid and
     * recorded — a bordered box mostly empty, on every visit, taking a line
     * above the conversations somebody came to read. Searching them is
     * something people do sometimes; reading them is what the page is.
     */
    expect(CSS).not.toMatch(/\.chat-search \{/);
    expect(CHATS).not.toMatch(/<input/);
    expect(VIEW).toMatch(/<SearchControl/);
    expect(VIEW).toMatch(/label="Search chats"/);
    // Leading corner, which the grid has held open since the title moved to
    // the middle — the app puts its own search disc in exactly this slot.
    expect(CSS).toMatch(/\.groups-head > \.groups-seek \{ grid-column: 1; justify-self: start; \}/);
  });

  it('is one control, worn by two pages', () => {
    /*
     * Home had this first. Writing it again for Chat would have meant two
     * copies of the focus handling, and every note on that handling is a bug
     * report — the `requestAnimationFrame` that focused the button behind the
     * field, the blur that fired when focus moved to the button beside it.
     */
    expect(SEARCH).toMatch(/export function SearchControl/);
    expect(HOME_VIEW).toMatch(/<SearchControl/);
    expect(VIEW).toMatch(/<SearchControl/);
    expect(HOME_VIEW).not.toMatch(/className="round search-go"/);
  });

  it('spends the heading rather than moving the plus', () => {
    /*
     * The app's `PageHead` gives up its wordmark when a field opens and leaves
     * the trailing corner exactly where it was, so the control somebody was
     * not reaching for never ends up under their cursor. The greeting is this
     * page's wordmark and the `+` is that corner.
     */
    expect(CARD).toMatch(/\{!searching && \(/);
    expect(CSS).toMatch(/\.groups-head:has\(\.search-open\) \.groups-new \{ grid-column: 2; \}/);
  });

  it('has nothing to open where there is nothing to search', () => {
    // On a page with no rooms it is a control that cannot succeed, sitting in
    // the corner above the paragraph explaining why there is nothing here.
    expect(VIEW).toMatch(/const searchable = chats\.length > 0/);
    expect(VIEW).toMatch(/searchable &&/);
  });
});
