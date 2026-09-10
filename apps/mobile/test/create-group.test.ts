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

const FORM = read('src/CreateGroup.tsx');
const EVENTS = read('src/Events.tsx');
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
     * Opening the form, removing a chip and backing out must all be free —
     * that is the property that makes suggesting a set of people acceptable
     * rather than presumptuous.
     */
    const calls = FORM.match(/api\.[a-zA-Z]+\(/g) ?? [];
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
  it('puts the consent line above the button', () => {
    /*
     * Creating from people adds them outright rather than asking. That is a
     * real thing to do to somebody, so the sentence saying it has to be read
     * before the decision — the order is what is asserted.
     */
    const consent = FORM.indexOf('They are told when the group is made');
    const button = FORM.indexOf('Create group');
    expect(consent).toBeGreaterThan(-1);
    expect(consent).toBeLessThan(button);
  });

  it('does not tell somebody to remove a chip that is not there', () => {
    // The from-scratch path preselects nobody, and "tap to take somebody out"
    // was then an instruction about controls that are not on screen.
    expect(FORM).toMatch(/Just you, for now/);
    expect(FORM).toMatch(/picked\.length > 0[\s\S]{0,400}offered\.length > 0/);
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
    // that event rather than from the people.
    expect(FORM).toMatch(/Together in \{cluster\.sharedEventCount\}/);
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
    expect(EVENTS).toMatch(/groups !== null && making !== 'anyone' && \(/);
    expect(EVENTS).not.toMatch(/groups\.length > 0 && [\s\S]{0,80}New group/);
  });

  it('opens one form at a time', () => {
    // Two half-filled forms on one screen is two things to cancel and a
    // question about which Create belongs to which.
    expect(EVENTS).toMatch(/const \[making, setMaking\] = useState<string \| null>\(null\)/);
  });

  it('lands in the room it just made', () => {
    // The next thing anybody wants is to put an event in it, and that button
    // is on the group's own screen.
    expect(EVENTS).toMatch(/onCreated=\{\(id\) => \{[\s\S]{0,80}onOpenGroup\(id\)/);
  });
});
