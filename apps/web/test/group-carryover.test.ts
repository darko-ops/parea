/**
 * A roll taken out of its group keeps everybody who was in the group.
 *
 * Being in a group's roll is read live off the group, so clearing `group_id`
 * alone would shut out everyone who was never let in by name — on a private
 * roll, everybody but its creator. `takeOutOfGroup` writes them in first, as
 * participants in by right; an upload to a roll in a group does the same for
 * the uploader, so leaving the group does not lock them out of what they
 * added to. Against a real database, because the whole question is what
 * `decide` reads.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { decide, findEventById, lockedOutByRotation, recordParticipant } from '@/access';
import type { Db } from '@/db';
import { outsideGroup, rollGroupSummary, takeOutOfGroup } from '@/groups';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "event", "event_participant", "group_member", "groups", "photo"
    restart identity cascade
  `);
});

async function person() {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', accountId: account!.id })
    .returning();
  return actor!.id;
}

/** A group of three and a private roll in it, made by the first of them. */
async function setting() {
  const [group] = await db.insert(schema.groups).values({ name: 'House', slug: 'house' }).returning();
  const [creator, member, other] = [await person(), await person(), await person()];
  await db.insert(schema.groupMembers).values([
    { groupId: group!.id, actorId: creator, role: 'admin' },
    { groupId: group!.id, actorId: member, role: 'member' },
    { groupId: group!.id, actorId: other, role: 'member' },
  ]);
  const [roll] = await db
    .insert(schema.events)
    .values({
      name: 'Cabin',
      linkToken: newLinkToken(),
      createdBy: creator,
      groupId: group!.id,
      accessPolicy: 'private',
    })
    .returning();
  await recordParticipant(db, roll!.id, creator);
  return { group: group!, roll: roll!, creator, member, other };
}

const sees = async (eventId: string, actorId: string) =>
  (await decide(db, (await findEventById(db, eventId))!, 'view', { actorId })).allow;

describe('taking a roll out of its group', () => {
  it('keeps everybody who was in the group in the roll, private as it is', async () => {
    const { roll, member, other } = await setting();
    expect(await sees(roll.id, member)).toBe(true);

    expect(await takeOutOfGroup(db, roll.id)).toBe(3);

    const after = (await findEventById(db, roll.id))!;
    expect(after.groupId).toBeNull();
    expect(await sees(roll.id, member)).toBe(true);
    expect(await sees(roll.id, other)).toBe(true);
  });

  it('does not let in whoever joins the group afterwards', async () => {
    const { group, roll } = await setting();
    await takeOutOfGroup(db, roll.id);
    const latecomer = await person();
    await db.insert(schema.groupMembers).values({ groupId: group.id, actorId: latecomer, role: 'member' });
    expect(await sees(roll.id, latecomer)).toBe(false);
  });

  it('leaves the expiry alone and answers null for a roll in no group', async () => {
    const { roll } = await setting();
    await takeOutOfGroup(db, roll.id);
    expect((await findEventById(db, roll.id))!.expiresAt).toBeNull();
    expect(await takeOutOfGroup(db, roll.id)).toBeNull();
  });

  it('keeps an existing participant’s role while letting them in by right', async () => {
    const { roll, member } = await setting();
    await recordParticipant(db, roll.id, member, 'host');
    await takeOutOfGroup(db, roll.id);
    const [row] = await db
      .select()
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.actorId, member));
    expect(row).toMatchObject({ role: 'host', admitted: true });
  });

  it('is not counted among the people a link rotation shuts out', async () => {
    const { roll } = await setting();
    await takeOutOfGroup(db, roll.id);
    const after = (await findEventById(db, roll.id))!;
    expect(await lockedOutByRotation(db, after)).toBe(0);
  });
});

describe('leaving a group after adding to one of its rolls', () => {
  it('keeps the uploader in the roll; somebody who only looked goes with the group', async () => {
    const { group, roll, member, other } = await setting();
    // What the upload route writes for a roll in a group.
    await recordParticipant(db, roll.id, member, 'member', true);

    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, group.id));
    expect(await sees(roll.id, member)).toBe(true);
    expect(await sees(roll.id, other)).toBe(false);
  });
});

describe('the route', () => {
  const ROUTE = readFileSync(
    fileURLToPath(new URL('../app/api/events/[id]/group/route.ts', import.meta.url)),
    'utf8',
  );
  const UPLOADS = readFileSync(
    fileURLToPath(new URL('../app/api/events/[id]/uploads/route.ts', import.meta.url)),
    'utf8',
  );

  it('lets an uploader to a roll in a group in by right', () => {
    expect(UPLOADS).toMatch(/recordParticipant\(db, event\.id, actorId, 'member', event\.groupId !== null\)/);
  });
});

/**
 * A roll in a group is shared with exactly the group.
 *
 * Nobody outside it comes in by name — an invitation or an approved request is
 * refused with what the client needs to ask: add them to the group, or take
 * the roll out of it. And it is always Group only.
 */
describe('a roll in a group is the group’s', () => {
  const src = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const INVITES = src('../app/api/events/[id]/invites/route.ts');
  const REQUESTS = src('../app/api/events/[id]/access-requests/route.ts');
  const PATCH = src('../app/api/events/[id]/route.ts');
  const CREATE = src('../app/api/events/route.ts');
  const UNGROUP = src('../app/api/events/[id]/group/route.ts');
  const MIGRATION = src('../../../packages/core/drizzle/0068_group_rolls_group_only.sql');

  it('finds who is outside the group', async () => {
    const { group, member } = await setting();
    const stranger = await person();
    expect(await outsideGroup(db, group.id, [member, stranger])).toEqual([stranger]);
    expect(await outsideGroup(db, group.id, [])).toEqual([]);
  });

  it('refuses to invite somebody outside it by name, and asks them into the group on request', () => {
    expect(INVITES).toMatch(/const outsiders = await outsideGroup\(db, event\.groupId, asked\);/);
    expect(INVITES).toMatch(/if \(body\.toGroup !== true\) \{\s*return NextResponse\.json\(await notInGroup\(db, event\.groupId, actorId, outsiders\), \{\s*status: 409,/);
    expect(INVITES).toMatch(/\?\.role !== 'admin'\) \{\s*return NextResponse\.json\(\{ error: 'admin_only' \}, \{ status: 403 \}\);/);
    expect(INVITES).toMatch(/toGroup = \(await inviteToGroup\(db, event\.groupId, actorId, outsiders\)\)\.length;/);
  });

  it('refuses to approve somebody outside it, and spends the request on a group invitation instead', () => {
    expect(REQUESTS).toMatch(/if \(outside && action === 'approve'\) \{\s*return NextResponse\.json\(await notInGroup\(db, event\.groupId, actorId, \[row\.actorId\]\)/);
    expect(REQUESTS).toMatch(/if \(outside\) await inviteToGroup\(db, event\.groupId, actorId, \[row\.actorId\]\);\s*await db\s*\.delete\(schema\.eventAccessRequests\)/);
  });

  it('is always Group only, made or changed', () => {
    expect(CREATE).toMatch(/accessPolicy: groupId \? PRIVATE : accessPolicy,/);
    expect(PATCH).toMatch(/if \(chosen !== PRIVATE && event\.groupId\) \{\s*return NextResponse\.json\(\{ error: 'group_only' \}, \{ status: 409 \}\);/);
    expect(MIGRATION).toMatch(/UPDATE "event" SET "access_policy" = 'private'\s*WHERE "group_id" IS NOT NULL AND "access_policy" = 'public';/);
    // Everybody already in one keeps it — let in by right before it closes.
    expect(MIGRATION.indexOf('SET "admitted" = true')).toBeLessThan(MIGRATION.indexOf('SET "access_policy"'));
  });

  it('can be taken out by its creator or a group admin — `administer`, and nothing narrower', () => {
    expect(UNGROUP).toMatch(/await guard\(db, event, 'administer', await requesterFor\(id\)\);/);
    expect(UNGROUP).not.toMatch(/createdBy/);
  });
});

describe("the group's header on a roll's settings", () => {
  it('gives a member the room, its size and its rolls', async () => {
    const { group, member } = await setting();
    const summary = await rollGroupSummary(db, group, member);
    expect(summary).toMatchObject({
      id: group.id,
      title: 'House',
      kind: 'named',
      memberCount: 3,
      eventCount: 1,
      member: true,
    });
  });

  it('gives somebody outside the group the door and nothing behind it', async () => {
    const { group } = await setting();
    const stranger = await person();
    const summary = await rollGroupSummary(db, group, stranger);
    expect(summary).toMatchObject({ title: 'House', memberCount: 3, member: false });
    expect(summary.deck).toEqual([]);
    expect(summary.photoUrl).toBeNull();
  });
});

