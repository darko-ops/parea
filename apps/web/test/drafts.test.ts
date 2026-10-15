/**
 * Drafts: your own photographs in a roll that are not in it yet — `src/drafts.ts`,
 * `/api/events/[id]/drafts`, `/api/photos/[id]/draft`, and the requeue's
 * rescue of uploads that arrived without being confirmed.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

let me: string | null = null;
let mayUpload = true;
const inStorage = new Set<string>();
const deleted: string[] = [];
const published: string[] = [];

vi.mock('@/session', () => ({
  currentActorId: async () => me,
  requesterFor: async () => ({ actorId: me }),
}));
vi.mock('@/access', async (actual) => ({
  ...(await actual<typeof import('@/access')>()),
  guard: async () => {
    if (!mayUpload) throw Object.assign(new Error('forbidden'), { status: 403 });
  },
  toResponse: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
}));
vi.mock('@/storage', () => ({
  getStorage: () => ({
    head: async (key: string) => (inStorage.has(key) ? { size: 4321 } : null),
    delete: async (key: string) => void deleted.push(key),
  }),
}));
vi.mock('@/queue', () => ({
  publishDerive: async (id: string) => {
    published.push(id);
    return 'published';
  },
}));

const { __setDbForTests } = await import('@/db');
const { claimDrafts, countsTowardCap, draftState, listDrafts } = await import('@/drafts');
const listRoute = await import('../app/api/events/[id]/drafts/route');
const draftRoute = await import('../app/api/photos/[id]/draft/route');
const requeue = await import('../app/api/cron/requeue-stranded/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;
let mine: string;
let theirs: string;
let roll: string;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "event", "photo", "job_run" restart identity cascade`);
  const [a] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [b] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [e] = await db.insert(schema.events).values({ name: 'Beach', linkToken: newLinkToken(), createdBy: a!.id }).returning();
  mine = a!.id;
  theirs = b!.id;
  roll = e!.id;
  me = mine;
  mayUpload = true;
  inStorage.clear();
  deleted.length = 0;
  published.length = 0;
  process.env.CRON_SECRET = 'cron-secret';
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
let n = 0;
async function photo(over: Partial<typeof schema.photos.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.photos)
    .values({
      eventId: roll,
      uploaderId: mine,
      storageKey: `k/${++n}`,
      byteSize: 1000,
      mime: 'image/jpeg',
      status: 'pending',
      uploadedAt: minutesAgo(60),
      ...over,
    })
    .returning();
  return row!;
}
const row = async (id: string) => (await db.select().from(schema.photos).where(eq(schema.photos.id, id)))[0]!;

describe('draftState', () => {
  const at = (m: number) => minutesAgo(m);
  it('reads the row', () => {
    expect(draftState({ status: 'pending', bytesAt: null, uploadedAt: at(2) })).toBe('sending');
    expect(draftState({ status: 'pending', bytesAt: null, uploadedAt: at(60) })).toBe('needs_file');
    expect(draftState({ status: 'pending', bytesAt: at(1), uploadedAt: at(60) })).toBe('processing');
    expect(draftState({ status: 'failed', bytesAt: at(1), uploadedAt: at(60) })).toBe('failed');
    expect(draftState({ status: 'failed', bytesAt: null, uploadedAt: at(60) })).toBe('needs_file');
  });
});

describe('listing drafts', () => {
  it('is mine alone, and never a live, quarantined, hidden or deleted photo', async () => {
    const draft = await photo({ status: 'failed', failureReason: 'never_arrived' });
    await photo({ uploaderId: theirs, status: 'failed' });
    await photo({ status: 'ready' });
    await photo({ status: 'quarantined' });
    await photo({ status: 'failed', hiddenAt: new Date() });
    await photo({ status: 'failed', deletedAt: new Date() });

    const body = await (await listRoute.GET(new Request('https://p.test'), { params: Promise.resolve({ id: roll }) })).json();
    expect(body.drafts.map((d: { id: string }) => d.id)).toEqual([draft.id]);
    expect(body.drafts[0]).toMatchObject({ state: 'needs_file', reason: 'never_arrived', mime: 'image/jpeg', size: 1000 });
  });

  it('is empty for somebody with no actor', async () => {
    await photo({ status: 'failed' });
    me = null;
    const body = await (await listRoute.GET(new Request('https://p.test'), { params: Promise.resolve({ id: roll }) })).json();
    expect(body.drafts).toEqual([]);
  });
});

describe('claimDrafts', () => {
  it('takes the draft a retry names, and a stopped one the same photo matches', async () => {
    const named = await photo({ status: 'failed' });
    const stopped = await photo({ byteSize: 2222, status: 'failed' });
    await photo({ byteSize: 3333, uploadedAt: minutesAgo(1) }); // still sending: not a match
    await photo({ byteSize: 4444, status: 'failed', bytesAt: new Date() }); // file is here: the server's to finish

    const claimed = await claimDrafts(db, roll, mine, [
      { size: 1000, type: 'image/jpeg', draftId: named.id },
      { size: 2222, type: 'image/jpeg' },
      { size: 3333, type: 'image/jpeg' },
      { size: 4444, type: 'image/jpeg' },
      { size: 2222, type: 'image/png' },
    ]);
    expect(claimed).toEqual([named.id, stopped.id, null, null, null]);
  });

  it('never takes somebody else’s draft, even by id', async () => {
    const other = await photo({ uploaderId: theirs, status: 'failed' });
    expect(await claimDrafts(db, roll, mine, [{ size: 1000, type: 'image/jpeg', draftId: other.id }])).toEqual([null]);
  });
});

describe('what counts toward the cap', () => {
  it('leaves out drafts with no file, and keeps everything else', async () => {
    await photo({ status: 'ready' });
    await photo({ status: 'pending' });
    await photo({ status: 'failed', bytesAt: new Date() });
    await photo({ status: 'failed' }); // a draft with no file
    const [r] = await db
      .select({ photos: count(), bytes: sum(schema.photos.byteSize) })
      .from(schema.photos)
      .where(and(eq(schema.photos.eventId, roll), countsTowardCap()));
    expect(r!.photos).toBe(3);
  });
});

const post = (id: string) =>
  draftRoute.POST(new Request('https://p.test', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id }) });
const del = (id: string) => draftRoute.DELETE(new Request('https://p.test', { method: 'DELETE' }), { params: Promise.resolve({ id }) });

describe('trying a draft again', () => {
  it('sends a failed photo whose file is here back to the deriver', async () => {
    const p = await photo({ status: 'failed', bytesAt: minutesAgo(600), failureReason: 'decode_failed' });
    inStorage.add(p.storageKey);
    const res = await post(p.id);
    expect(await res.json()).toMatchObject({ state: 'processing' });
    expect(published).toEqual([p.id]);
    expect(await row(p.id)).toMatchObject({ status: 'pending', failureReason: null });
  });

  it('finishes an upload that arrived without being confirmed', async () => {
    const p = await photo();
    inStorage.add(p.storageKey);
    expect((await post(p.id)).status).toBe(200);
    expect((await row(p.id)).bytesAt).not.toBeNull();
    expect(published).toEqual([p.id]);
  });

  it('asks for the photo again when the file is not here', async () => {
    const p = await photo();
    const res = await post(p.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'needs_file' });
    expect(await row(p.id)).toMatchObject({ status: 'failed', failureReason: 'never_arrived' });
  });

  it('is refused once the roll no longer takes photos from them', async () => {
    const p = await photo({ status: 'failed', bytesAt: new Date() });
    mayUpload = false;
    expect((await post(p.id)).status).toBe(403);
    expect(published).toEqual([]);
  });

  it('is not found for somebody else’s photo, a live one or a quarantined one', async () => {
    const other = await photo({ uploaderId: theirs, status: 'failed' });
    const live = await photo({ status: 'ready' });
    const held = await photo({ status: 'quarantined' });
    for (const p of [other, live, held]) expect((await post(p.id)).status).toBe(404);
  });
});

describe('removing a draft', () => {
  it('tombstones it and deletes any file', async () => {
    const p = await photo({ status: 'failed' });
    expect((await del(p.id)).status).toBe(200);
    expect(deleted).toEqual([p.storageKey]);
    expect((await row(p.id)).deletedAt).not.toBeNull();
  });

  it('cannot remove a live photo or a quarantined one', async () => {
    const live = await photo({ status: 'ready' });
    const held = await photo({ status: 'quarantined' });
    for (const p of [live, held]) {
      expect((await del(p.id)).status).toBe(404);
      expect((await row(p.id)).deletedAt).toBeNull();
    }
  });
});

describe('the requeue rescues uploads that arrived unconfirmed', () => {
  const run = () =>
    requeue.GET(new Request('https://p.test/api/cron/requeue-stranded', { headers: { authorization: 'Bearer cron-secret' } }));

  it('finds the file, records it as arrived, and sends it', async () => {
    const arrived = await photo({ uploadedAt: minutesAgo(45) });
    const neverSent = await photo({ uploadedAt: minutesAgo(45) });
    const tooSoon = await photo({ uploadedAt: minutesAgo(5) });
    inStorage.add(arrived.storageKey);
    inStorage.add(tooSoon.storageKey);

    const body = await (await run()).json();
    expect(body).toMatchObject({ rescued: 1, sent: 1 });
    expect(published).toEqual([arrived.id]);
    expect((await row(arrived.id)).byteSize).toBe(4321);
    expect((await row(neverSent.id)).bytesAt).toBeNull();
  });
});

describe('the processing-failure alarm', () => {
  it('is not raised by drafts whose file never arrived', async () => {
    const { deriveFailures } = await import('@/deriveBacklog');
    await photo({ status: 'failed', failedAt: new Date(), failureReason: 'never_arrived' });
    await photo({ status: 'failed', failedAt: new Date(), failureReason: 'object_missing' });
    await photo({ status: 'failed', failedAt: new Date(), failureReason: 'decode_failed: heic' });
    const { failed, byKind } = await deriveFailures(db, minutesAgo(60));
    expect(failed).toBe(1);
    expect(byKind.map((k) => k.kind)).toEqual(['decode_failed']);
  });
});
