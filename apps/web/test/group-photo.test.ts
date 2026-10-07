/**
 * A group's own picture — the room's profile picture.
 *
 * Set by the group's hosts and co-hosts — the `admin` role — from its settings,
 * under its name, and refused where a name is refused. Renaming is theirs for
 * the same reason (security review L13): the name and the picture are the
 * group's face to everybody in it, and a member who wants either changed asks.
 * Only ever handed to people in the room: a door to a group somebody is not in
 * carries a name and a count and nothing else.
 *
 * Who may change them is asserted by calling the routes, not by reading them:
 * "a member is refused and an admin is not" is a fact about a request, and a
 * source check would pass just as happily with the role test in the wrong
 * branch.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const ROUTE = read('../app/api/groups/[id]/photo/route.ts');
const GROUP = read('../app/api/groups/[id]/route.ts');
const GROUPS = read('../src/groups.ts');
const SCHEMA = read('../../../packages/core/src/schema.ts');
const MIGRATION = read('../../../packages/core/drizzle/0047_group_photo.sql');

describe('a group photo', () => {
  it('is one nullable column on the group', () => {
    expect(SCHEMA).toMatch(/photoKey: text\('photo_key'\),/);
    expect(MIGRATION).toMatch(/ALTER TABLE "groups" ADD COLUMN "photo_key" text;/);
  });

  it('is set by an admin, and not on a chat between two people', () => {
    expect(ROUTE).toMatch(/membershipOf\(db, group\.id, actorId\)/);
    expect(ROUTE).toMatch(/membership\.role !== 'admin'/);
    expect(ROUTE).toMatch(/error: 'admin_only' \}, \{ status: 403 \}/);
    expect(ROUTE).toMatch(/memberCount\(db, group\.id\)\) < 3/);
    expect(ROUTE).toMatch(/error: 'chat_not_nameable' \}, \{ status: 409 \}/);
  });

  it('is re-encoded as a square JPEG, under a key that changes each time', () => {
    expect(ROUTE).toMatch(/fit: 'cover'/);
    expect(ROUTE).toMatch(/\.jpeg\(\{ quality: 82, mozjpeg: true \}\)/);
    // A new key per picture, so a phone caching by URL never shows the old one.
    expect(ROUTE).toMatch(/const key = `groups\/\$\{group\.id\}-\$\{randomUUID\(\)\}\.jpg`;/);
    expect(ROUTE).toMatch(/if \(group\.photoKey\) await storage\.delete\(group\.photoKey\)/);
  });

  it('reaches members and nobody else', () => {
    const door = GROUP.slice(GROUP.indexOf('if (!membership) {'), GROUP.indexOf('const since ='));
    expect(door).not.toMatch(/photoUrl|photoKey/);
    expect(GROUP).toMatch(/photoUrl: await groupPhotoUrl\(group\.photoKey\),/);
    expect(GROUPS).toMatch(/export async function groupPhotoUrl\(/);
  });
});

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { addMember } = await import('@/groups');
const groupRoute = await import('../app/api/groups/[id]/route');
const photoRoute = await import('../app/api/groups/[id]/photo/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

describe("a group's name and picture, and who may change them", () => {
  let db: Db;

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema }) as unknown as Db;
    await migrate(db as never, { migrationsFolder: MIGRATIONS });
    __setDbForTests(db);
  });

  beforeEach(async () => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      truncate "account", "actor", "groups", "group_member"
      restart identity cascade
    `);
    headerBag.clear();
  });

  let seq = 0;
  async function person(displayName: string) {
    const [account] = await db
      .insert(schema.accounts)
      .values({ email: `gp${++seq}@example.test` })
      .returning();
    const [actor] = await db
      .insert(schema.actors)
      .values({ kind: 'user', accountId: account!.id, handle: `gp${seq}`, displayName })
      .returning();
    return actor!.id;
  }

  function as(actorId: string) {
    headerBag.set('authorization', `Bearer ${sign(actorId)}`);
  }

  /** A room of three — big enough to be named — with one host in it. */
  async function room() {
    const host = await person('Demetri');
    const member = await person('Ana');
    const third = await person('Jack');
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Sunday tennis', slug: 'sunday-tennis' })
      .returning();
    await addMember(db, group!.id, host, 'admin');
    await addMember(db, group!.id, member);
    await addMember(db, group!.id, third);
    return { id: group!.id, host, member };
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  function rename(id: string, name: string) {
    return groupRoute.PATCH(
      new Request(`https://parea.test/api/groups/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
      params(id),
    );
  }

  async function nameOf(id: string) {
    const [row] = await db.select().from(schema.groups).where(eq(schema.groups.id, id));
    return row!.name;
  }

  it('refuses a member who renames it, and leaves the name alone', async () => {
    const { id, member } = await room();
    as(member);
    const res = await rename(id, 'Monday squash');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'admin_only' });
    expect(await nameOf(id)).toBe('Sunday tennis');
  });

  it('lets an admin rename it', async () => {
    const { id, host } = await room();
    as(host);
    const res = await rename(id, 'Monday squash');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ named: 'Monday squash' });
    expect(await nameOf(id)).toBe('Monday squash');
  });

  it('refuses a member who changes or removes the picture', async () => {
    const { id, member } = await room();
    as(member);
    const posted = await photoRoute.POST(
      new Request(`https://parea.test/api/groups/${id}/photo`, {
        method: 'POST',
        body: new Uint8Array([0xff, 0xd8, 0xff]),
      }),
      params(id),
    );
    expect(posted!.status).toBe(403);
    expect(await posted!.json()).toEqual({ error: 'admin_only' });

    const removed = await photoRoute.DELETE(
      new Request(`https://parea.test/api/groups/${id}/photo`, { method: 'DELETE' }),
      params(id),
    );
    expect(removed!.status).toBe(403);
    expect(await removed!.json()).toEqual({ error: 'admin_only' });
  });

  it('lets an admin remove the picture', async () => {
    // Removing rather than setting: a set runs the upload through the image
    // decoder and the child-safety screen, neither of which is who-may.
    const { id, host } = await room();
    as(host);
    const res = await photoRoute.DELETE(
      new Request(`https://parea.test/api/groups/${id}/photo`, { method: 'DELETE' }),
      params(id),
    );
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true });
  });

  /** Just the creator and the first person they asked, and maybe a name. */
  async function pair(name: string | null) {
    const host = await person('Demetri');
    const other = await person('Parea');
    const [group] = await db
      .insert(schema.groups)
      .values(name ? { name, slug: name.toLowerCase().replace(/\s+/g, '-') } : { name: null, slug: null })
      .returning();
    await addMember(db, group!.id, host, 'admin');
    await addMember(db, group!.id, other);
    return { id: group!.id, host };
  }

  it('lets the admin of a named group of two rename it', async () => {
    // A group somebody made and named is a group from the start, while it is
    // still just them and the first person they asked.
    const { id, host } = await pair('Book club');
    as(host);
    const res = await rename(id, 'Reading club');
    expect(res.status).toBe(200);
    expect(await nameOf(id)).toBe('Reading club');
  });

  it('still will not name a conversation between two people', async () => {
    const { id, host } = await pair(null);
    as(host);
    const res = await rename(id, 'Us');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'chat_not_nameable' });
    expect(await nameOf(id)).toBeNull();
  });

  it('still hides the group from somebody who is not in it', async () => {
    // Not in it is not found, not "admins only" — the second would confirm it exists.
    const { id } = await room();
    as(await person('Stranger'));
    expect((await rename(id, 'Mine now')).status).toBe(404);
  });
});
