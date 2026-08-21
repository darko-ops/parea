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

  it('still says where groups come from when there is nothing to recognise', () => {
    // A new account sees no clusters, and the page must not read as broken.
    expect(PAGE).toMatch(/You are not in any groups yet/);
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
    const tile = PAGE.match(/<span\s+className="group-tile"[\s\S]*?<\/span>/)?.[0] ?? '';
    expect(tile).not.toBe('');
    expect(tile).not.toMatch(/<img|<Face|cover/);
    expect(tile).toMatch(/slice\(0, 1\)\.toUpperCase\(\)/);
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

  it('says the role only when it is one', () => {
    // "Member" on every other row is a word that appears so often it stops
    // being read, on the rows where it changes nothing.
    expect(PAGE).toMatch(/role === 'admin'/);
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
    const door = GROUP.slice(GROUP.indexOf('if (!group.member)'), GROUP.indexOf('const byId'));
    expect(door).not.toBe('');
    expect(door).not.toMatch(/<Face|archive|EventCover|events\.length/);
  });
});

describe('inside a group', () => {
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
    expect(GROUP).toContain('Photos live in the events, not in the group.');
  });

  it('words its months and dates on the server', () => {
    // A boundary computed in the browser can disagree with the HTML it is
    // hydrating, and React answers that by throwing the tree away.
    expect(GROUP_PAGE).toMatch(/function monthOf/);
    expect(GROUP).not.toMatch(/toLocaleDateString|new Intl\.DateTimeFormat/);
  });

  it('never prints a raw date string', () => {
    // What it did: `2025-09-12` beside an event name.
    expect(GROUP).not.toMatch(/event\.eventDate|event\.eventDate/);
  });
});

describe('the rail', () => {
  it('puts Groups above Search', () => {
    /*
     * Order is the argument. Home and Activity are what has already happened
     * to you; Groups is the rooms you are already in; Search is the only row
     * that goes looking for something you are not part of yet. Below Search
     * would file the places you belong under the heading for finding places
     * you do not.
     */
    const groups = RAIL.indexOf("label: 'Groups'");
    const search = RAIL.indexOf("label: 'Search'");
    const activity = RAIL.indexOf("label: 'Activity'");
    expect(groups).toBeGreaterThan(-1);
    expect(activity).toBeLessThan(groups);
    expect(groups).toBeLessThan(search);
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
