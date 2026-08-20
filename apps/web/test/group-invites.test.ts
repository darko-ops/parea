/**
 * Inviting somebody into a group, and the three rules that make it safe.
 *
 * This feature answers a question the product had deliberately left open, so
 * the answer is worth pinning rather than leaving to be re-derived:
 *
 * **An invitation skips the join request, and it must.** `group_join_request`
 * exists so an admin decides who comes in. An invitation is that same decision
 * taken first rather than in reply — the person who would have approved is the
 * person who sent it. One rule, two directions.
 *
 * **Which is why only an admin may send one.** If any member could invite, the
 * approval could be routed around by asking a friend on the inside, and the
 * request queue would become decorative.
 *
 * **And being invited is an offer, not a fact.** Writing the membership
 * outright would let one person's guest list write itself into another
 * person's account. The row is `open` until answered.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  answerGroupInvite,
  inviteToGroup,
  membershipOf,
  pendingGroupInvites,
} from '@/groups';

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
    truncate "account", "actor", "groups", "group_member", "group_invite", "block"
    restart identity cascade
  `);
});

/** An account, because `invitable` refuses a guest device. */
async function person(handle: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.com` })
    .returning();
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle, accountId: account!.id })
    .returning();
  return row!.id;
}

async function group(adminId: string) {
  const [row] = await db
    .insert(schema.groups)
    .values({ name: 'Sunday roast', slug: `s-${Math.floor(performance.now() * 1000)}` })
    .returning();
  await db
    .insert(schema.groupMembers)
    .values({ groupId: row!.id, actorId: adminId, role: 'admin' });
  return row!.id;
}

describe('being asked into a group', () => {
  it('does not put anybody in it', async () => {
    /*
     * The whole difference between an invitation and an admin adding somebody.
     * One line would make this write the membership, and then a guest list
     * would be a thing one person writes into another person's account.
     */
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);

    expect(await inviteToGroup(db, id, admin, [them])).toEqual([them]);
    expect(await membershipOf(db, id, them)).toBeNull();

    const waiting = await pendingGroupInvites(db, them);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ groupName: 'Sunday roast', from: '@admin' });
  });

  it('is what makes somebody a member, when they say yes', async () => {
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    const [invite] = await inviteToGroup(db, id, admin, [them]).then(() =>
      pendingGroupInvites(db, them),
    );

    expect(await answerGroupInvite(db, invite!.id, them, true)).toBe(true);
    expect(await membershipOf(db, id, them)).toMatchObject({ role: 'member' });
    // And it leaves the queue, so the card cannot be answered twice.
    expect(await pendingGroupInvites(db, them)).toEqual([]);
  });

  it('leaves them out when they say no', async () => {
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    const [invite] = await inviteToGroup(db, id, admin, [them]).then(() =>
      pendingGroupInvites(db, them),
    );

    expect(await answerGroupInvite(db, invite!.id, them, false)).toBe(true);
    expect(await membershipOf(db, id, them)).toBeNull();
  });

  it('cannot be answered by somebody else', async () => {
    // Scoped to the invitation's own actor in the statement. Anything else is
    // a way to accept on another person's behalf.
    const admin = await person('admin');
    const them = await person('them');
    const stranger = await person('stranger');
    const id = await group(admin);
    const [invite] = await inviteToGroup(db, id, admin, [them]).then(() =>
      pendingGroupInvites(db, them),
    );

    expect(await answerGroupInvite(db, invite!.id, stranger, true)).toBe(false);
    expect(await membershipOf(db, id, stranger)).toBeNull();
    expect(await membershipOf(db, id, them)).toBeNull();
  });

  it('cannot be answered twice', async () => {
    // Two tabs, or one impatient tap. Answering again must not turn a decline
    // back into an accept.
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    const [invite] = await inviteToGroup(db, id, admin, [them]).then(() =>
      pendingGroupInvites(db, them),
    );

    expect(await answerGroupInvite(db, invite!.id, them, false)).toBe(true);
    expect(await answerGroupInvite(db, invite!.id, them, true)).toBe(false);
    expect(await membershipOf(db, id, them)).toBeNull();
  });

  it('does not turn a no back into a waiting', async () => {
    /*
     * Asking again after a decline. `onConflictDoNothing` rather than an
     * upsert: re-inviting somebody who said no would be an admin overruling a
     * decision that was not theirs to make.
     */
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    const [invite] = await inviteToGroup(db, id, admin, [them]).then(() =>
      pendingGroupInvites(db, them),
    );
    await answerGroupInvite(db, invite!.id, them, false);

    expect(await inviteToGroup(db, id, admin, [them])).toEqual([]);
    expect(await pendingGroupInvites(db, them)).toEqual([]);

    const [row] = await db
      .select({ status: schema.groupInvites.status })
      .from(schema.groupInvites)
      .where(
        and(eq(schema.groupInvites.groupId, id), eq(schema.groupInvites.actorId, them)),
      );
    expect(row?.status).toBe('declined');
  });
});

describe('who may be asked', () => {
  it('is not somebody who has blocked you, in either direction', async () => {
    /*
     * The consent gate, and the only thing standing between somebody and being
     * added by a person they have cut off. Checked per person on the server
     * rather than trusted from the list the client sent.
     */
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: them, blockedActorId: admin });

    expect(await inviteToGroup(db, id, admin, [them])).toEqual([]);
    expect(await pendingGroupInvites(db, them)).toEqual([]);
  });

  it('is not a guest device', async () => {
    // Being in a group has to mean something that survives the browser it
    // happened in, which an actor with no account does not.
    const admin = await person('admin');
    const id = await group(admin);
    const [guest] = await db
      .insert(schema.actors)
      .values({ kind: 'guest' })
      .returning();

    expect(await inviteToGroup(db, id, admin, [guest!.id])).toEqual([]);
  });

  it('is not somebody already in it, or yourself', async () => {
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    await db.insert(schema.groupMembers).values({ groupId: id, actorId: them });

    expect(await inviteToGroup(db, id, admin, [them, admin])).toEqual([]);
  });
});

describe('a group that is gone', () => {
  it('takes its invitations out of the queue', async () => {
    // A row pointing at nothing is not an invitation, and answering it would
    // put somebody into a group that no longer exists.
    const admin = await person('admin');
    const them = await person('them');
    const id = await group(admin);
    await inviteToGroup(db, id, admin, [them]);

    await db
      .update(schema.groups)
      .set({ deletedAt: new Date() })
      .where(eq(schema.groups.id, id));

    expect(await pendingGroupInvites(db, them)).toEqual([]);
  });
});
