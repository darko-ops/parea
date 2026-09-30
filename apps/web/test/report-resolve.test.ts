/**
 * What an album's host may answer: open removal requests, and nothing else.
 *
 * The resolve route loaded any report by id and asked only whether the caller
 * hosted the album, so a host could decline an abuse or child-safety report
 * about their own upload and lift the hide it had put on the photograph.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { POST } = await import('../app/api/reports/[id]/resolve/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "event", "photo", "report" restart identity cascade`);
  headerBag.clear();
});

/** A host with one photo in their album, and a report of `kind` about it. */
async function reported(kind: 'removal_request' | 'abuse' | 'child_safety', photoStatus = 'ready') {
  const [account] = await db.insert(schema.accounts).values({ email: `${crypto.randomUUID()}@x.test` }).returning();
  const [host] = await db.insert(schema.actors).values({ kind: 'user', accountId: account!.id }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: host!.id })
    .returning();
  const [photo] = await db
    .insert(schema.photos)
    .values({
      eventId: event!.id,
      uploaderId: host!.id,
      storageKey: `ev/${event!.id}/p`,
      byteSize: 10,
      mime: 'image/jpeg',
      status: photoStatus as 'ready',
      hiddenAt: new Date(),
    })
    .returning();
  const [report] = await db.insert(schema.reports).values({ photoId: photo!.id, kind }).returning();
  headerBag.set('authorization', `Bearer ${sign(host!.id)}`);
  return { report: report!.id, photo: photo!.id };
}

const answer = (reportId: string, action: 'remove' | 'decline') =>
  POST(
    new Request(`https://parea.test/api/reports/${reportId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: reportId }) },
  );

const photoRow = async (id: string) =>
  (await db.select().from(schema.photos).where(eq(schema.photos.id, id)))[0]!;

describe('a host answering reports about their album', () => {
  it('can answer a removal request', async () => {
    const { report, photo } = await reported('removal_request');
    expect((await answer(report, 'decline')).status).toBe(200);
    expect((await photoRow(photo)).hiddenAt).toBeNull();
  });

  for (const kind of ['abuse', 'child_safety'] as const) {
    it(`cannot close a ${kind} report, or lift what it hid`, async () => {
      const { report, photo } = await reported(kind, kind === 'child_safety' ? 'quarantined' : 'ready');
      expect((await answer(report, 'decline')).status).toBe(404);
      const row = await photoRow(photo);
      expect(row.hiddenAt).not.toBeNull();
      const [still] = await db.select().from(schema.reports);
      expect(still!.status).toBe('open');
    });
  }

  it('leaves a photo held for child safety to its reviewer', async () => {
    const { report, photo } = await reported('removal_request', 'quarantined');
    expect((await answer(report, 'remove')).status).toBe(409);
    expect((await photoRow(photo)).status).toBe('quarantined');
  });

  it('answers each request once', async () => {
    const { report } = await reported('removal_request');
    expect((await answer(report, 'decline')).status).toBe(200);
    expect((await answer(report, 'remove')).status).toBe(404);
  });
});
