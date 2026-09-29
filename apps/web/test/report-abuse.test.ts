/**
 * Reports and removal requests act on somebody else's album, so neither can be
 * free to send without limit.
 *
 * A removal request hides its photo after 48 hours if the host does not
 * answer, and a child-safety report hides it at once and wakes a person. Both
 * used to be open to anybody who could see the album, signed out, with no
 * limit — enough to empty an album in two days, or at once, and page the
 * responder once per photograph.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

// The limits are counted under the session secret; without one they stand
// aside, which would make this file test nothing.
process.env.SESSION_SECRET = 'report-abuse-test-secret-0123456789abcdef';

const headerBag = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const removal = await import('../app/api/photos/[id]/removal-request/route');
const report = await import('../app/api/photos/[id]/report/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "event", "photo", "report", "safety_incident", "rate_limit"
    restart identity cascade
  `);
  headerBag.clear();
});

let seq = 0;
async function person(signedIn = true) {
  const account = signedIn
    ? (await db.insert(schema.accounts).values({ email: `r${++seq}@example.test` }).returning())[0]
    : null;
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: signedIn ? 'user' : 'guest', accountId: account?.id ?? null })
    .returning();
  return actor!.id;
}

/** A public album — anybody may look — with some photographs in it. */
async function album(photos: number) {
  const host = await person();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: host })
    .returning();
  const ids: string[] = [];
  for (let i = 0; i < photos; i++) {
    const [photo] = await db
      .insert(schema.photos)
      .values({
        eventId: event!.id,
        uploaderId: host,
        storageKey: `ev/${event!.id}/${i}`,
        byteSize: 10,
        mime: 'image/jpeg',
        status: 'ready',
      })
      .returning();
    ids.push(photo!.id);
  }
  return ids;
}

function as(actorId: string | null) {
  headerBag.clear();
  if (actorId) headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

const post = (handler: typeof removal.POST, photoId: string, body: unknown = {}) =>
  handler(
    new Request(`https://parea.test/api/photos/${photoId}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: photoId }) },
  );

describe('asking for a photo to come down', () => {
  it('needs an account', async () => {
    const [photo] = await album(1);
    as(await person(false));
    expect((await post(removal.POST, photo!)).status).toBe(401);
    as(null);
    expect((await post(removal.POST, photo!)).status).toBe(401);
    expect(await db.select().from(schema.reports)).toHaveLength(0);

    as(await person());
    expect((await post(removal.POST, photo!)).status).toBe(200);
    expect(await db.select().from(schema.reports)).toHaveLength(1);
  });

  it('is limited per account', async () => {
    const photos = await album(25);
    as(await person());
    const answers = [];
    for (const id of photos) answers.push((await post(removal.POST, id)).status);
    expect(answers.filter((s) => s === 200)).toHaveLength(20);
    expect(answers.filter((s) => s === 429)).toHaveLength(5);
  });
});

describe('reporting a child being abused', () => {
  it('hides only a handful of photos per reporter before a person has looked', async () => {
    const photos = await album(7);
    as(await person());
    for (const id of photos) {
      expect((await post(report.POST, id, { kind: 'child_safety' })).status).toBe(200);
    }
    // Every report is kept; only the first five hid their photo on receipt.
    expect(await db.select().from(schema.reports)).toHaveLength(7);
    const quarantined = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.status, 'quarantined'));
    expect(quarantined).toHaveLength(5);
    expect(await db.select().from(schema.safetyIncidents)).toHaveLength(5);
  });

  it('does not open a second incident for a photo already hidden', async () => {
    const [photo] = await album(1);
    as(await person());
    await post(report.POST, photo!, { kind: 'child_safety' });
    as(await person());
    await post(report.POST, photo!, { kind: 'child_safety' });

    expect(await db.select().from(schema.reports)).toHaveLength(2);
    expect(await db.select().from(schema.safetyIncidents)).toHaveLength(1);
  });

  it('is still open to somebody who is not signed in', async () => {
    // A report of a child being abused should cost nothing to make.
    const [photo] = await album(1);
    as(await person(false));
    expect((await post(report.POST, photo!, { kind: 'child_safety' })).status).toBe(200);
    const [row] = await db.select().from(schema.photos);
    expect(row!.status).toBe('quarantined');
  });
});
