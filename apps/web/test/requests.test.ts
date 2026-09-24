/**
 * What counts as waiting on you.
 *
 * The bubble on Activity is a number, and a number is a promise: it says that
 * this many people are on the other end of something unanswered. Both ways of
 * getting it wrong are quiet. Too high and somebody opens the list looking for
 * work that is not there, decides the number lies, and stops opening it. Too
 * low and a request sits unanswered — which the person who sent it cannot tell
 * apart from a refusal, and cannot ask about.
 *
 * The half worth testing hardest is the one that is new: asks to get into
 * events *you* run. They were previously visible only inside each event's
 * Members tab, so nothing has ever had an opinion about which of them are
 * yours to answer.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { joinRequestsFor, otherRequestsWaiting, pendingRequestsFor } from '@/requests';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "event", "event_participant",
      "event_access_request", "event_invite", "friend_request",
      "groups", "group_member"
    restart identity cascade
  `);
});

async function actor(handle?: string) {
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle: handle ?? null })
    .returning();
  return row!.id;
}

async function event(createdBy: string, overrides = {}) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy, ...overrides })
    .returning();
  return row!;
}

async function ask(eventId: string, actorId: string, status = 'open') {
  await db.insert(schema.eventAccessRequests).values({ eventId, actorId, status } as never);
}

async function group(name = 'The group') {
  const [row] = await db
    .insert(schema.groups)
    .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
    .returning();
  return row!;
}

describe('people asking into events you run', () => {
  it('reaches the host, who previously had to open the event to find out', async () => {
    const host = await actor();
    const stranger = await actor('stranger');
    const party = await event(host, { name: 'Barcelona' });
    await ask(party.id, stranger);

    const waiting = await joinRequestsFor(db, host);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      kind: 'join',
      eventId: party.id,
      title: '@stranger',
      detail: 'would like to join Barcelona',
    });
  });

  it('reaches an admin of the group the event belongs to', async () => {
    // `administer` is creator-or-group-admin, and the Members tab lets both
    // answer. A list that showed only what you created would be telling one of
    // them about a subset of what they can act on.
    const host = await actor();
    const admin = await actor();
    const stranger = await actor('stranger');
    const theirs = await group();
    await db
      .insert(schema.groupMembers)
      .values({ groupId: theirs.id, actorId: admin, role: 'admin' });

    const party = await event(host, { groupId: theirs.id });
    await ask(party.id, stranger);

    expect(await joinRequestsFor(db, admin)).toHaveLength(1);
  });

  it('does not reach an ordinary member of that group', async () => {
    const host = await actor();
    const member = await actor();
    const stranger = await actor('stranger');
    const theirs = await group();
    await db
      .insert(schema.groupMembers)
      .values({ groupId: theirs.id, actorId: member, role: 'member' });

    const party = await event(host, { groupId: theirs.id });
    await ask(party.id, stranger);

    expect(await joinRequestsFor(db, member)).toEqual([]);
  });

  it('counts a request once when you are both the creator and a group admin', async () => {
    // Two reasons to be shown the same request, and one person waiting. The
    // bubble is a count, so a row that arrives twice is not a cosmetic repeat
    // in a list — it is the number saying something untrue.
    const host = await actor();
    const stranger = await actor('stranger');
    const theirs = await group();
    await db
      .insert(schema.groupMembers)
      .values({ groupId: theirs.id, actorId: host, role: 'admin' });

    const party = await event(host, { groupId: theirs.id });
    await ask(party.id, stranger);

    expect(await joinRequestsFor(db, host)).toHaveLength(1);
  });

  it('drops the ones already answered, and the ones pointing at a deleted event', async () => {
    const host = await actor();
    const a = await actor('a');
    const b = await actor('b');
    const c = await actor('c');

    const party = await event(host);
    await ask(party.id, a, 'approved');
    await ask(party.id, b, 'declined');

    const gone = await event(host, { name: 'Gone', deletedAt: new Date() });
    await ask(gone.id, c);

    expect(await joinRequestsFor(db, host)).toEqual([]);
  });

  it('is not somebody else’s to answer', async () => {
    const host = await actor();
    const somebodyElse = await actor();
    const stranger = await actor('stranger');
    await ask((await event(host)).id, stranger);

    expect(await joinRequestsFor(db, somebodyElse)).toEqual([]);
  });
});

describe('the whole queue', () => {
  it('is the three kinds together, newest first', async () => {
    const me = await actor('me');
    const host = await actor('host');
    const stranger = await actor('stranger');

    // Mine to run, and somebody wants in.
    const mine = await event(me, { name: 'Mine' });
    await ask(mine.id, stranger);

    // Theirs, and I have been asked into it.
    const theirs = await event(host, { name: 'Theirs', caption: 'the long weekend' });
    await db
      .insert(schema.eventInvites)
      .values({ eventId: theirs.id, actorId: me, invitedByActorId: host });

    await db
      .insert(schema.friendRequests)
      .values({ fromActorId: stranger, toActorId: me });

    const queue = await pendingRequestsFor(db, me);
    expect(queue.map((r) => r.kind).sort()).toEqual(['friend', 'invite', 'join']);
    // Sorted, and every key distinct — two tables can hand out the same uuid,
    // and a repeated React key silently drops a row from the list.
    expect(queue.map((r) => r.at)).toEqual([...queue.map((r) => r.at)].sort().reverse());
    expect(new Set(queue.map((r) => r.key)).size).toBe(3);

    const invite = queue.find((r) => r.kind === 'invite');
    expect(invite).toMatchObject({ title: 'Theirs', eventId: theirs.id });
    expect(invite?.detail).toContain('the long weekend');
  });

  it('gives the badge the two kinds it was blind to, and not the invitations', async () => {
    // `invitesWaiting` already counts open invitations, and the badge adds
    // these to it. Counting an invitation here as well would double it.
    const me = await actor('me');
    const host = await actor('host');
    const stranger = await actor('stranger');

    await ask((await event(me)).id, stranger);
    await db
      .insert(schema.friendRequests)
      .values({ fromActorId: stranger, toActorId: me });
    const theirs = await event(host);
    await db
      .insert(schema.eventInvites)
      .values({ eventId: theirs.id, actorId: me, invitedByActorId: host });

    expect(await pendingRequestsFor(db, me)).toHaveLength(3);
    expect(await otherRequestsWaiting(db, me)).toBe(2);
  });

  it('is empty for a browser that has never been anybody', async () => {
    // The rail links to Activity for everyone, guests included.
    expect(await pendingRequestsFor(db, null)).toEqual([]);
    expect(await joinRequestsFor(db, null)).toEqual([]);
  });
});

/**
 * Where an album's two queues are answered.
 *
 * Source checks, because there is no DOM in this suite — they stand in for the
 * browser run that confirmed the tab against a real album.
 *
 * The thing being pinned is not a layout. Both of these had a route and no
 * screen next to the people they are about: being let into a private album was
 * answered on `/manage`, which a host reaches by opening the `···` and
 * choosing a menu item, and being allowed to add photographs was answered only
 * in Notifications, on the list of everything else waiting. Neither is
 * somewhere a host goes on the chance that somebody is on the other end.
 */
describe('an album answers its requests where the people are', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const EVENT = read('../app/components/EventView.tsx');
  const QUEUE = read('../app/components/AlbumRequests.tsx');
  const MANAGE = read('../app/components/ManageView.tsx');
  const PAGE = read('../app/event/[id]/page.tsx');

  it('draws both queues on the People tab, and only for somebody who can answer', () => {
    const pane = EVENT.slice(EVENT.indexOf("tab === 'people'"), EVENT.indexOf('<People'));
    expect(pane).toMatch(/feed\.event\.canAdminister && \(\s*<AlbumRequests/);
    expect(QUEUE).toMatch(/access-requests/);
    expect(QUEUE).toMatch(/host-requests/);
    // Not rendered rather than rendered empty: a reader who cannot administer
    // never calls the route, so there is nothing for it to refuse.
    expect(pane).not.toMatch(/<AlbumRequests[^>]*\/>\s*\}?\s*$/);
  });

  it('keeps them two lists, because they are two questions', () => {
    /*
     * The route that serves them makes this argument and it holds where they
     * are drawn together: the access queue is strangers at the door of a
     * private album and the question is "do I know this person"; the host
     * queue is people already inside, whom the host can see in the roster
     * below, asking for a little more.
     */
    expect(QUEUE).toMatch(/waiting to be let in/);
    expect(QUEUE).toMatch(/asking to add photographs/);
    expect(QUEUE).toMatch(/Let them in/);
    expect(QUEUE).toMatch(/Allow/);
  });

  it('counts both on the tab, and counts them for nobody else', () => {
    // A pip that promised two and opened on three would be worse than none.
    expect(PAGE).toMatch(/eventHostRequests/);
    expect(PAGE).toMatch(/waiting: \(waitingRow\[0\]\?\.n \?\? 0\) \+ \(hostRow\[0\]\?\.n \?\? 0\)/);
    expect(PAGE).toMatch(/canAdminister\s*\?/);
    expect(EVENT).toMatch(/id === 'people' && feed\.event\.waiting > 0/);
  });

  it('takes the row away after the server answers, not before', () => {
    // An optimistic removal takes somebody off the screen and leaves them
    // waiting when the call failed — the one outcome a host would never find
    // out about.
    const answer = QUEUE.slice(QUEUE.indexOf('const answer = useCallback'));
    expect(answer.indexOf('if (!res.ok)')).toBeLessThan(answer.indexOf('const drop'));
    // And the roster is rebuilt only where approving changed it.
    expect(answer).toMatch(/if \(action === 'approve'\) onApproved\(\)/);
  });

  it('leaves Manage the things that are actually administration', () => {
    /*
     * The queue is gone from there rather than mirrored: the same list
     * answerable in two screens is two places to keep in step, and a host who
     * approved in one would have to trust the other caught up.
     *
     * What stays is what the screen's own docstring says it is for — the
     * removal reports, which run against a 48-hour clock, and the switches.
     */
    expect(MANAGE).not.toMatch(/access-requests/);
    expect(MANAGE).not.toMatch(/<h2>Requests<\/h2>/);
    expect(MANAGE).toMatch(/reports/);
    expect(MANAGE).toMatch(/AccessChoice/);
    // And the badge that pointed at it, which was a number two hops from the
    // thing it was about.
    expect(EVENT).not.toMatch(/badge=\{feed\.event\.waiting\}/);
  });
});
