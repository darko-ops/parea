/**
 * Naming a co-host, which is mostly a question about *when* the role is written.
 *
 * `0034_event_hosts` put it on the participant row, and that is the right place:
 * being a host of an album is a property of being in it, so leaving takes the
 * row and the role together and there is no state where somebody is a host of an
 * album they are not in. What that shape cannot express is the moment the role
 * is usually decided — an album set to `host` is asked who its co-hosts are
 * while it is being made, when nobody has a participant row at all, because an
 * invitation grants nothing until it is accepted.
 *
 * So the promise waits on `event_invite.as_host` and acceptance spends it. Which
 * gives the album's owner a set with two kinds of row in it — people who are
 * here with the role, and people who were named and have not answered — and the
 * tests below are about keeping those two honestly apart:
 *
 *   - a pending co-host is not a host, and must not be drawn as one
 *   - accepting is what makes them one, in the same write as the row
 *   - declining makes them nothing, because there is no row
 *   - the owner can take either kind back out, with one call
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recordParticipant } from '@/access';
import type { Db } from '@/db';
import { invitedTo, membersOf, rosterFor } from '@/members';
import { pendingInvites } from '@/invites';
import { stripComments } from './support/source';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "event", "event_participant", "event_invite"
    restart identity cascade
  `);
});

async function person(displayName: string | null, handle: string | null = null) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName, handle, accountId: account!.id })
    .returning();
  return actor!.id;
}

async function album(
  createdBy: string,
  contributePolicy: 'everyone' | 'creator' | 'host' | 'nobody' = 'host',
) {
  const [event] = await db
    .insert(schema.events)
    .values({
      name: 'The evening',
      linkToken: newLinkToken(),
      createdBy,
      contributePolicy,
    })
    .returning();
  return event!;
}

/** What `POST /invites` writes for somebody named a co-host. */
async function ask(eventId: string, actorId: string, by: string, asHost: boolean) {
  const [invite] = await db
    .insert(schema.eventInvites)
    .values({ eventId, actorId, invitedByActorId: by, asHost })
    .returning();
  return invite!;
}

describe('a co-host who has not answered yet', () => {
  it('is on the roster as asked, and is not a host', async () => {
    /*
     * The one thing this whole shape exists to keep true. The role is what
     * `authorize` reads for `upload`, and it lives on a row that does not exist
     * until somebody accepts — so a client that drew a pending co-host as a host
     * would offer an Add button the server refuses, and the album's owner would
     * be left wondering where the photographs went.
     */
    const owner = await person('Wren');
    const sam = await person('Sam', 'sam');
    const event = await album(owner);
    await ask(event.id, sam, owner, true);

    const [row] = await invitedTo(db, event.id);
    expect(row).toMatchObject({ actorId: sam, role: 'invited', isHost: false });
    // And the fact that makes them different from any other invitee.
    expect(row!.hostAsked).toBe(true);
  });

  it('is told what they are agreeing to', async () => {
    // Accepting a plain invitation is joining; accepting this one is also taking
    // on the camera. Somebody who found that out afterwards was asked one
    // question and answered another.
    const owner = await person('Wren');
    const sam = await person('Sam', 'sam');
    const event = await album(owner);
    await ask(event.id, sam, owner, true);

    const [waiting] = await pendingInvites(db, sam);
    expect(waiting).toMatchObject({ eventId: event.id, asHost: true });
  });

  it('is not confused with somebody asked in the ordinary way', async () => {
    const owner = await person('Wren');
    const guest = await person('Ada', 'ada');
    const event = await album(owner);
    await ask(event.id, guest, owner, false);

    const [row] = await invitedTo(db, event.id);
    expect(row!.hostAsked).toBe(false);
  });
});

describe('answering an invitation to co-host', () => {
  it('writes the role in the same statement as the row', async () => {
    /*
     * Not an UPDATE afterwards. A phone that has just accepted goes straight to
     * the album and asks whether it may add; a second statement still in flight
     * would have it told no, on an album it was invited to co-host.
     */
    const owner = await person('Wren');
    const sam = await person('Sam', 'sam');
    const event = await album(owner);

    await recordParticipant(db, event.id, sam, 'host');

    const [participant] = await db
      .select({ role: schema.eventParticipants.role })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, event.id),
          eq(schema.eventParticipants.actorId, sam),
        ),
      );
    expect(participant!.role).toBe('host');
  });

  it('defaults to member, so a plain arrival grants nothing', async () => {
    // Every other door into an album calls this without a role — a link, a code,
    // an approved request — and none of them is a promotion.
    const owner = await person('Wren');
    const ada = await person('Ada');
    const event = await album(owner);

    await recordParticipant(db, event.id, ada);

    const [participant] = await db
      .select({ role: schema.eventParticipants.role })
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.actorId, ada));
    expect(participant!.role).toBe('member');
  });

  it('reads as a co-host on the roster once they are in', async () => {
    const owner = await person('Wren');
    const sam = await person('Sam', 'sam');
    const event = await album(owner);
    await recordParticipant(db, event.id, sam, 'host');

    const roster = await rosterFor(db, event.id, new Map());
    const sams = roster.find((row) => row.actorId === sam);
    // Granted, and therefore no longer a promise about anything.
    expect(sams).toMatchObject({ isHost: true, hostAsked: false });
  });

  it('leaves nothing behind when the answer is no', async () => {
    /*
     * A declined invitation writes no participant row, so there is no role — the
     * promise is simply never spent. Which is also why declining does not need
     * undoing anywhere: nothing was granted.
     */
    const owner = await person('Wren');
    const sam = await person('Sam', 'sam');
    const event = await album(owner);
    const invite = await ask(event.id, sam, owner, true);

    await db
      .update(schema.eventInvites)
      .set({ status: 'declined', respondedAt: new Date() })
      .where(eq(schema.eventInvites.id, invite.id));

    expect(await membersOf(db, event.id)).toEqual([]);
    // And off the roster, because a decision already made is not a queue.
    expect(await invitedTo(db, event.id)).toEqual([]);
  });
});

describe('the creator', () => {
  it('is a host of their own album without a row saying so', async () => {
    // `authorize` reads `createdBy` directly. A second place storing the same
    // fact is a pair that disagrees eventually, and the wrong one wins silently.
    const owner = await person('Wren');
    const event = await album(owner);
    await recordParticipant(db, event.id, owner);

    const [row] = await membersOf(db, event.id, event.createdBy);
    expect(row).toMatchObject({ isCreator: true, isHost: true });
  });
});

describe('the routes that write all this', () => {
  it('asks co-hosts in through the invite route, not the host route', () => {
    /*
     * Because it is one act. There is no co-host of an album somebody is not in,
     * and the role cannot be written before they arrive — so naming one is
     * asking them in with a promise attached, and a second endpoint would be a
     * second act that has to stay in step with the first.
     */
    const route = stripComments(read('app/api/events/[id]/invites/route.ts'));
    expect(route).toContain('hostActorIds');
    expect(route).toContain('asHost: wantsHost.has(target)');
  });

  it('counts both lists against one cap', () => {
    // It is one guest list with a bound on it. A limit per list would be a
    // hundred people, said as fifty twice.
    const route = stripComments(read('app/api/events/[id]/invites/route.ts'));
    expect(route).toMatch(/const asked = \[\.\.\.hostAsked, \.\.\.memberAsked\]/);
    expect(route).toContain('asked.length > MAX_PER_REQUEST');
  });

  it('never turns an answer already given back into a question', () => {
    /*
     * The upgrade path — somebody asked as a member and now wanted as a co-host
     * — is scoped to an open invitation. A declined one stays declined, which is
     * the rule this table has had since invitations stopped granting access.
     */
    const route = stripComments(read('app/api/events/[id]/invites/route.ts'));
    const upgrade = route.slice(route.indexOf('.set({ asHost: true })'));
    expect(upgrade).toContain("eq(schema.eventInvites.status, 'open')");
  });

  it('takes a co-host back out whether or not they have arrived', () => {
    // One control, one call. "Take Sam back out" is the same sentence either
    // way, and an owner should not have to know which kind of row Sam has.
    const route = stripComments(read('app/api/events/[id]/hosts/route.ts'));
    expect(route).toContain('.set({ asHost: body.host })');
    expect(route).toContain("eq(schema.eventInvites.status, 'open')");
  });

  it('will not demote the creator, rather than pretending to', () => {
    const route = stripComments(read('app/api/events/[id]/hosts/route.ts'));
    expect(route).toContain('creator_is_host');
  });

  it('keeps the co-host list to whoever administers the album', () => {
    /*
     * The People tab already shows everybody who may add, to everybody in the
     * album, and that is the right disclosure for a room. This list has open
     * invitations in it, which are not something the rest of the album is told
     * about.
     */
    const route = stripComments(read('app/api/events/[id]/hosts/route.ts'));
    const get = route.slice(route.indexOf('export async function GET'));
    expect(get).toContain("'administer'");
  });
});

describe('what both clients say', () => {
  it('asks who the co-hosts are on the screen that offers "Hosts"', () => {
    /*
     * "Hosts" with no way to name one means "Only me" until somebody finds the
     * People tab — which is a strange thing for an album to do on the evening it
     * is made, since the person handing over the camera is standing next to
     * whoever they are handing it to.
     */
    for (const [file, guard] of [
      ['app/page.tsx', 'contribute === CONTRIBUTE_HOST'],
      ['../mobile/src/CreateEvent.tsx', "contribute === 'host'"],
    ] as const) {
      const source = stripComments(read(file));
      expect(source).toContain(guard);
      expect(source.toLowerCase()).toContain('co-host');
    }
  });

  it('sends the co-hosts only where the setting means anything', () => {
    /*
     * Somebody who picked two co-hosts and then chose "Only me" has changed
     * their mind about the album. Asking those people in *as co-hosts* of an
     * album nobody but its owner can add to would honour a sentence they backed
     * out of — so the names are kept and they go in as members instead.
     */
    for (const file of ['app/page.tsx', '../mobile/src/CreateEvent.tsx']) {
      const source = stripComments(read(file));
      expect(source).toMatch(/hosting \? coHosts : \[\]/);
      expect(source).toMatch(/hosting \? \[\] : coHosts/);
    }
  });

  it('manages them in the same place the setting lives', () => {
    // The second half of one decision, not a second question — so it sits inside
    // the panel that raises it rather than in a card of its own.
    for (const [file, guard] of [
      ['app/components/ManageView.tsx', 'contribute === CONTRIBUTE_HOST'],
      ['../mobile/App.tsx', "adding === 'host'"],
    ] as const) {
      const source = stripComments(read(file));
      expect(source).toContain(guard);
      expect(source).toContain('Remove');
    }
  });

  it('calls them co-hosts in the people section, not hosts', () => {
    /*
     * The album has one host — whoever made it, who cannot stop being one — and
     * these are the people they handed the camera to. Calling both the same made
     * the list read as though the album had several owners, which is the thing a
     * co-host is deliberately not.
     */
    for (const file of ['app/components/EventView.tsx', '../mobile/src/Thread.tsx']) {
      const source = stripComments(read(file));
      expect(source).toContain('Co-host');
      expect(source).not.toContain("'Make a host'");
    }
  });

  it('asks who can see it before who can add, on both', () => {
    /*
     * The order is load-bearing rather than a layout choice: the contribute
     * options are *named* by the access policy — the middle one is "Everyone" on
     * a public album and "Members" on a private one — so asking who can add
     * first means somebody chooses a label and then ticks a switch underneath
     * that renames what they chose.
     *
     * The app has always asked them this way round. The web did not, which is
     * two products disagreeing about two questions that depend on each other.
     */
    for (const [file, see, add] of [
      ['app/page.tsx', 'WHO CAN SEE IT', 'WHO CAN ADD PHOTOS'],
      ['../mobile/src/CreateEvent.tsx', 'WHO CAN SEE IT', 'WHO CAN ADD PHOTOS'],
    ] as const) {
      const source = stripComments(read(file));
      expect(source.indexOf(see)).toBeGreaterThan(-1);
      expect(source.indexOf(see)).toBeLessThan(source.indexOf(add));
    }
  });

  it('offers the same three answers, in the same words, in both', () => {
    /*
     * A phone and a browser describing one setting differently is two products.
     * The two `ContributeChoice` files are separate because one draws React DOM
     * and the other React Native, so the copy is the thing that has to be
     * checked rather than shared.
     */
    const labels = ['Everyone', 'Only me', 'Hosts', 'Members'];
    for (const file of [
      'app/components/ContributeChoice.tsx',
      '../mobile/src/ContributeChoice.tsx',
    ]) {
      const source = stripComments(read(file));
      for (const label of labels) expect(source).toContain(`'${label}'`);
    }
  });

  it('says a co-host cannot administer the album', () => {
    // The property the setting rests on: the set of people who can add cannot
    // grow without the album's owner. Said on both screens that offer it.
    for (const file of ['app/components/ManageView.tsx', '../mobile/App.tsx']) {
      const source = stripComments(read(file));
      expect(source).toMatch(/cannot rename the album/);
    }
  });
});
