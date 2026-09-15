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
    expect(calls).toEqual(['api.createGroupFrom(']);
  });

  it('sends people, not an event', () => {
    // The roll-up is a different act on a different endpoint shape, and the
    // two are kept as separate methods for that reason.
    expect(API).toMatch(/createGroupFrom\(name: string, memberIds: string\[\]\)/);
    expect(API).toMatch(/JSON\.stringify\(\{ name, memberIds \}\)/);
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
    expect(PAGE).toMatch(/picked\.length > 0\s*\?/);
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
    expect(APP).toMatch(/setTab\('groups'\);\s*setMakeGroup\(\(n\) => n \+ 1\);/);
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
     * A ternary, not a guard: the `+` is hidden while the groups are arriving,
     * and the envelope beside it sits in a row laid out from the right. Without
     * something holding the place, the envelope was drawn where the `+` belongs
     * and slid left the moment the groups landed. A control that is somewhere
     * else for the first half-second is one somebody reaches for and misses.
     */
    expect(EVENTS).toMatch(/groups !== null \? \(/);
    expect(EVENTS).toMatch(/<View style=\{styles\.roundSlot\} \/>/);
    expect(EVENTS).toMatch(/roundSlot: \{ width: ROUND, height: ROUND \}/);
    expect(EVENTS).not.toMatch(/groups\.length > 0 && [\s\S]{0,80}New group/);
  });

  it('is the same `+` as Home and You', () => {
    /*
     * It made a group and only a group, because it is on the groups tab. That
     * is the reasoning that produces an app where one glyph means two things in
     * one place and one thing in another, which nobody can learn.
     */
    expect(EVENTS).toMatch(/onPress=\{\(\) => setStarting\(true\)\}[\s\S]{0,120}New album or group/);
    const tab = EVENTS.slice(EVENTS.indexOf('export function GroupsTab'));
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

  it('lands in the room it just made', () => {
    // The next thing anybody wants is to put an event in it, and that button
    // is on the group's own screen.
    expect(APP).toMatch(/onCreated=\{\(id\) => \{[\s\S]{0,240}setRoute\(\{ screen: 'group', id \}\)/);
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
