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
const CHATS = await read('../app/components/GroupChats.tsx');
const GROUPS_SRC = await read('../src/groups.ts');
const GROUP_PAGE = await read('../app/group/[id]/page.tsx');
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

  it('leads with who, before it offers to make anything', () => {
    /*
     * The whole argument of this screen in one assertion. A create control
     * that appears without the people it would be made from is the empty-room
     * failure the old design refused outright — so the page must read the
     * clusters, and the primary card must be one of them.
     */
    expect(PAGE).toMatch(/recurringClusters\(db, actorId\)/);
    expect(PAGE).toMatch(/The same people keep turning up\./);
    expect(PAGE).toMatch(/<CreateGroupCard/);
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
     * looks like the button being moved back inside a branch.
     */
    expect(PAGE).toMatch(/<NewGroupPanel greeting=\{greeting\} also=\{also\} \/>/);
    expect(PAGE).not.toMatch(/groups\.length > 0 && <NewGroupPanel/);
    expect(CARD).toMatch(/New group/);
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
  it('draws the tile as a letter, never a photograph', () => {
    /*
     * This assertion used to be "nothing on this page may be an image", and
     * that was the rule stated more broadly than its reason. The reason is
     * about *the door* — the search page's group card, where the viewer may
     * not be a member and a borrowed picture would show a room to somebody
     * outside it. It does not reach a list of groups the viewer is in.
     *
     * What survives, and is the part that was always load-bearing: the tile
     * stands for the group rather than for anything inside it, so it is a
     * letter in a lens colour on every screen a group appears on.
     */
    const tile = CHATS.match(/<span\s+className="group-tile chat-tile"[\s\S]*?<\/span>/)?.[0] ?? '';
    expect(tile).not.toBe('');
    expect(tile).not.toMatch(/<img|<Face|cover/);
    expect(tile).toMatch(/initialOf\(chat\.name\)/);
    expect(CHATS).toMatch(/slice\(0, 1\)\.toUpperCase\(\)/);
    // And the same on the group's own screen.
    const headTile = GROUP.match(/className="group-tile group-head-tile"[\s\S]*?<\/span>/)?.[0] ?? '';
    expect(headTile).not.toBe('');
    expect(headTile).not.toMatch(/<img|<Face/);
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
     * The room is not gone, it is one tab away: `?tab=chat` lands in the
     * conversation and the albums and people are beside it.
     */
    expect(CHATS).toMatch(/\?tab=chat/);
    expect(CHATS).toMatch(/chat\.last\.body/);
    expect(CHATS).toMatch(/Nobody has said anything yet\./);
    for (const furniture of ['group-strip', 'GroupCover', 'View all', 'group-meta', '<Face']) {
      expect(PAGE, `${furniture} is the room, not the chat`).not.toContain(furniture);
      expect(CHATS, `${furniture} is the room, not the chat`).not.toContain(furniture);
    }
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
  it('measures the room in albums and age, not in members', () => {
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
    expect(row).toMatch(/aria-label="New album in this group"/);
    // The word is gone from the button and nowhere else in the page picked it
    // up — two create controls with different labels is the drift this stops.
    expect(GROUP).not.toContain('New album here');
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
    expect(empty).toMatch(/The next album anybody makes in this group shows up/);
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
    expect(GROUP).toContain('Photos live in the albums, not in the group.');
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

  it('is shaped like an album: three tabs, and the URL says which', async () => {
    /*
     * A room and an evening are the same kind of object to somebody reading —
     * a thing with pictures in it, a conversation about them, and the people
     * it belongs to. `?tab=` rather than state, for the reason the album's
     * three use it: a link to the room's people is a link somebody can send,
     * and Back is the way out of it.
     */
    expect(GROUP).toMatch(/const TABS: \[GroupTab, string, RailGlyph\]\[\] = \[/);
    expect(GROUP).toMatch(/\['albums', 'Albums', 'photos'\]/);
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

  it('shelves albums two across rather than as a month-by-month archive', () => {
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

  it('dates an album by when it was made', async () => {
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
  it('puts Groupchats above Find', () => {
    /*
     * Order is the argument. Albums and Notifications are what has already
     * happened to you; Groupchats is the rooms you are already in; Find is the
     * only row that goes looking for something you are not part of yet. Below
     * Find would file the places you belong under the heading for finding
     * places you do not.
     *
     * The words are the app's now — see the rail's own note — so the rows are
     * matched on `page`, which is what the code calls them and what has not
     * moved. A relabelling should not be able to fail this; a reordering is
     * what it is for.
     */
    const at = (page: string) => RAIL.indexOf(`page: '${page}'`);
    expect(at('groups')).toBeGreaterThan(-1);
    expect(at('invites')).toBeLessThan(at('groups'));
    expect(at('groups')).toBeLessThan(at('find'));
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
