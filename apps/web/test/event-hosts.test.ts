/**
 * Hosts of an album — the people who may add photographs to one set to `host`.
 *
 * "Only me" said something untrue on an album inside a group: `contribute:
 * 'host'` has always meant the creator *and* the group's admins, and both
 * clients labelled it as one person. Two things follow from fixing that label.
 *
 * The first is that there has to be a setting that means what "Only me" said,
 * which is `creator`. The second is that if the strict one has moved out, the
 * other is free to be what its name claims: a set, which somebody can be added
 * to and — since they are already in the album and can see what is missing —
 * can ask to join.
 *
 * ## What a host is not
 *
 * An administrator. `authorize` reads the role for `upload` and nothing else,
 * so a host adds photographs and cannot rename the album, change who can see
 * it, let anybody in, or promote anybody. That last one is the property the
 * whole feature rests on: the set cannot grow without the album's owner.
 */

import {
  CONTRIBUTE_CREATOR,
  CONTRIBUTE_EVERYONE,
  CONTRIBUTE_HOST,
  CONTRIBUTE_NOBODY,
  PRIVATE,
  PUBLIC,
  authorize,
  type PolicyEvent,
} from '@parea/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const OWNER = 'owner';
const GUEST = 'guest';

function album(overrides: Partial<PolicyEvent> = {}): PolicyEvent {
  return {
    id: 'e',
    linkToken: 'tok',
    capEpoch: 1,
    accessPolicy: PUBLIC,
    joinsOpen: true,
    contributePolicy: CONTRIBUTE_HOST,
    createdBy: OWNER,
    groupId: null,
    deletedAt: null,
    ...overrides,
  };
}

const guest = { id: GUEST, hasAccount: true };

describe('who may add to an album', () => {
  it('lets a host add, and everybody else it does not', () => {
    const event = album();
    expect(
      authorize(guest, 'upload', { event }, { isParticipant: true, isEventHost: true }).allow,
    ).toBe(true);
    const refused = authorize(guest, 'upload', { event }, { isParticipant: true });
    expect(refused).toEqual({ allow: false, reason: 'host_only' });
  });

  it('keeps `creator` to one person, group admins included', () => {
    /*
     * The setting "Only me" was supposed to be and was not. `host` has always
     * admitted a group's admins, so on an album inside a group the strictest
     * thing on offer was still several people — and with promotion it would
     * have been several more. A setting called "Only me" that admits whoever
     * an admin decides to admit is a setting that lies.
     *
     * Not even a group admin, who can still `administer` the album — change
     * this very setting included. That is the honest shape: the photographs
     * are one person's to put in, and what the album *is* stays the group's.
     */
    const event = album({ contributePolicy: CONTRIBUTE_CREATOR, groupId: 'g' });
    expect(authorize({ id: OWNER, hasAccount: true }, 'upload', { event }, {}).allow).toBe(true);
    for (const presented of [
      { isParticipant: true, isEventHost: true },
      { isGroupMember: true, isGroupAdmin: true },
    ]) {
      expect(authorize(guest, 'upload', { event }, presented)).toEqual({
        allow: false,
        reason: 'host_only',
      });
    }
  });

  it('does not make a host an administrator', () => {
    /*
     * The property the feature rests on: the set of people who can add cannot
     * grow without the album's owner, because promotion is `administer`-only
     * and being a host does not confer it.
     */
    const event = album();
    expect(
      authorize(guest, 'administer', { event }, { isParticipant: true, isEventHost: true }),
    ).toEqual({ allow: false, reason: 'not_administrator' });
  });

  it('still understands the setting nothing offers any more', () => {
    /*
     * `nobody` is on neither client's list — it was a way of ending an album
     * that people reached for by accident and could not find their way back
     * out of, since the setting that undoes it is the one they had just
     * closed. The engine keeps the branch: a value that exists in a deployed
     * client and not here fails closed on the wrong side of a rollback, and
     * `0034_event_hosts` moves the albums that held it rather than trusting
     * that nothing does.
     */
    const event = album({ contributePolicy: CONTRIBUTE_NOBODY });
    expect(authorize({ id: OWNER, hasAccount: true }, 'upload', { event }, {})).toEqual({
      allow: false,
      reason: 'uploads_closed',
    });
    expect(read('../../packages/core/drizzle/0034_safe_doctor_octopus.sql')).toMatch(
      /UPDATE "event" SET "contribute_policy" = 'creator' WHERE "contribute_policy" = 'nobody'/,
    );
  });

  it('leaves the conversation alone whoever may add', () => {
    // `contribute` and `upload` are separate capabilities precisely so that
    // "hosts add the photographs" does not become "hosts may speak".
    const event = album();
    expect(authorize(guest, 'contribute', { event }, { isParticipant: true }).allow).toBe(true);
  });
});

describe('asking to be one', () => {
  const ROUTE = read('app/api/events/[id]/host-requests/route.ts');
  const HOSTS = read('app/api/events/[id]/hosts/route.ts');

  it('only from somebody already in, on an album where it means anything', () => {
    /*
     * `contribute` is the capability that already means "entitled to take
     * part", so a stranger with a guessed id gets the 404 a nonexistent album
     * gets. Signed in, because the host is being asked about a person. And
     * only on an album set to `host`: on `everyone` they can already add, and
     * on `creator` the point of the setting is that there is no set to join.
     */
    expect(ROUTE).toMatch(/decide\(db, event, 'contribute', requester\)/);
    expect(ROUTE).toMatch(/sign_in_required/);
    expect(ROUTE).toMatch(/event\.contributePolicy !== CONTRIBUTE_HOST/);
  });

  it('keeps a no a no', () => {
    // A declined row stays declined, and a second POST returns it rather than
    // reopening it: the button is one tap, and "no" is not a thing the host
    // should have to keep saying.
    expect(ROUTE).toMatch(/if \(existing\) return NextResponse\.json\(\{ status: existing\.status \}\)/);
  });

  it('writes the role before resolving the request', () => {
    /*
     * The order the access queue already uses, for the same reason: a crash
     * between the two writes should leave somebody approved who can already
     * add and a question the host answers twice, not somebody marked approved
     * who cannot add and has no way to say so.
     */
    const patch = ROUTE.slice(ROUTE.indexOf('export async function PATCH'));
    expect(patch.indexOf("set({ role: 'host' })")).toBeLessThan(
      patch.indexOf('.update(schema.eventHostRequests)'),
    );
  });

  it('answers only from somebody who administers the album', () => {
    for (const source of [ROUTE, HOSTS]) {
      expect(source).toMatch(/decide\(db, event, 'administer', await requesterFor\(id\)\)/);
    }
  });

  it('refuses to demote the creator rather than pretending to', () => {
    // They are a host by being the creator and `authorize` reads `createdBy`
    // directly, so a write here would be a second place the same fact lives.
    // A manage screen that appears to demote the owner and does not is worse
    // than one that says it will not.
    expect(HOSTS).toMatch(/creator_is_host/);
  });

  it('closes an open ask when the host promotes somebody instead', () => {
    // A host can go looking rather than waiting. Leaving the row open would
    // show a question about a person who already has the answer.
    expect(HOSTS).toMatch(/\.update\(schema\.eventHostRequests\)[\s\S]{0,200}status: 'approved'/);
  });
});

describe('how the ask reaches a human', () => {
  it('goes in the one queue, because nothing else announces it', () => {
    /*
     * There is no push for a host request — it is somebody already inside
     * asking for a little more, and interrupting an evening for it would spend
     * the notification budget on the least urgent thing in the product. So the
     * "waiting on you" list and the badge over the album's `⋯` are the whole
     * of how it is seen, and a badge that did not count it would leave the ask
     * with no route to anybody.
     */
    const REQUESTS = read('src/requests.ts');
    expect(REQUESTS).toMatch(/export async function hostRequestsFor/);
    expect(REQUESTS).toMatch(/hostRequestsFor\(db, actorId\),[\s\S]{0,200}\]\);\s*\n\s*return friends\.length/);
    expect(REQUESTS).toMatch(/\.\.\.hosts,/);
    // And narrowed to albums still set to `host`: one moved to `everyone` has
    // answered the ask by making it moot.
    expect(REQUESTS).toMatch(/eq\(schema\.events\.contributePolicy, CONTRIBUTE_HOST\)/);
  });

  it('is counted into the album’s own badge', () => {
    const FEED = read('app/api/events/[id]/photos/route.ts');
    expect(FEED).toMatch(/const waiting = \(waitingRows\[0\]\?\.n \?\? 0\) \+ \(hostWaitingRows\[0\]\?\.n \?\? 0\)/);
  });
});

describe('what the two clients draw', () => {
  it('reads the standing off the server rather than re-deriving it', () => {
    /*
     * `canAdd` is already the server's decision about this reader rather than
     * a client's reading of `contributePolicy`; the sentence beside it follows
     * the same rule. One helper, called by both the first frame and the route
     * that replaces it — a notice that appears or disappears between the two
     * is the page contradicting itself while somebody watches.
     */
    expect(read('src/hosts.ts')).toMatch(/export async function hostingFor/);
    for (const surface of [
      'app/api/events/[id]/photos/route.ts',
      'app/event/[id]/page.tsx',
    ]) {
      expect(read(surface), surface).toMatch(/hostingFor\(/);
    }
  });

  it('says who adds here, and offers the one thing to do', () => {
    const VIEW = read('app/components/EventView.tsx');
    expect(VIEW).toMatch(/Hosts add the photographs here\./);
    expect(VIEW).toMatch(/Ask to be a host/);
    // Only where asking exists. An album set to "Only me" says its piece and
    // offers nothing, which is correct: there is no set to join.
    expect(VIEW).toMatch(/!feed\.canAdd && feed\.hosting\.canAsk/);
  });

  it('answers the `+` itself, rather than leaving the corner empty', () => {
    /*
     * The sentence above is the half nobody reads: somebody who opened the
     * album to add photographs goes for the `+` in the corner, and a corner
     * with nothing in it is the page looking broken rather than the album being
     * closed. So the control is drawn for a reader who may not add, and the
     * press is what explains — one note, and the one thing to do about it.
     */
    const VIEW = read('app/components/EventView.tsx');
    const DIALOG = read('app/components/AddRefused.tsx');
    // A button rather than the label, because it opens a dialog and not a file
    // picker — under the same name and the same round chrome as the label.
    expect(VIEW).toMatch(/onClick=\{\(\) => setRefused\(true\)\}/);
    expect(VIEW).toMatch(/className="round event-add"[\s\S]{0,120}aria-label="Add photos"/);
    expect(VIEW).toMatch(/<AddRefused/);
    // The two buttons, and the one that does something is the ask this album
    // already had — one endpoint, not a second way to ask.
    expect(DIALOG).toMatch(/Request access/);
    expect(DIALOG).toMatch(/OK/);
    expect(VIEW).toMatch(/onAsk=\{askToHost\}/);
    /*
     * And the dialog decides what to offer off the server's answer, exactly as
     * the line beside the gallery does: `canAsk` on an album set to "Only me"
     * is false, so it says its piece and offers nothing.
     */
    expect(VIEW).toMatch(/canAsk=\{feed\.hosting\.canAsk\}/);
    expect(DIALOG).toMatch(/const mayAsk = canAsk && !pending && !allowed && asked !== 'declined'/);
  });

  it('offers the promotion only where it means something', () => {
    const VIEW = read('app/components/EventView.tsx');
    expect(VIEW).toMatch(/Make a host/);
    expect(VIEW).toMatch(/canAdminister &&\s*\n\s*hosted &&/);
    expect(VIEW).toMatch(/person\.role !== 'creator'/);
  });

  it('names the two answers to "who can see it" differently', () => {
    // The two settings compose, and this one used to defer to the other in
    // prose — "anyone who can see the album" — leaving somebody to work the
    // composition out. The answer is named instead.
    const CHOICE = read('app/components/ContributeChoice.tsx');
    expect(CHOICE).toMatch(new RegExp(`accessPolicy === ${PRIVATE.toUpperCase()}`));
    expect(CHOICE).toMatch(/label: 'Members'/);
    expect(CHOICE).toMatch(/label: 'Everyone'/);
  });

  it('still lets the everyone case add', () => {
    // The label changed on a private album; the value did not.
    const event = album({ accessPolicy: PRIVATE, contributePolicy: CONTRIBUTE_EVERYONE });
    // `capEpoch` because a participant's stored capability is what carries
    // them into a private album — see `authorize`. Nothing to do with hosts;
    // leaving it out denies on `no_credential` and would pass this test for
    // the wrong reason.
    expect(
      authorize(guest, 'upload', { event }, { isParticipant: true, capEpoch: event.capEpoch })
        .allow,
    ).toBe(true);
  });
});
