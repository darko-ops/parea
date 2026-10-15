/**
 * Which upload failures become an issue for the fixing agent — `src/uploadPatterns.ts`.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { device, fileIssues, findPatterns, issueFor, isPattern } from '@/uploadPatterns';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "event", "upload_failure" restart identity cascade`);
});

async function people(n: number) {
  const rows = await db
    .insert(schema.actors)
    .values(Array.from({ length: n }, (_, i) => ({ kind: 'guest' as const, handle: `secret.handle.${i}`, displayName: `Secret Name ${i}` })))
    .returning();
  return rows.map((r) => r.id);
}

async function fail(actorId: string, over: Partial<typeof schema.uploadFailures.$inferInsert> = {}) {
  await db.insert(schema.uploadFailures).values({
    actorId,
    source: 'client',
    stage: 'put',
    kind: 'Error',
    error: 'upload failed: 403',
    client: 'web',
    userAgent: IPHONE,
    mime: 'image/jpeg',
    ...over,
  });
}

const base = { source: 'client' as const, stage: 'put', error: 'x', client: 'web', kind: 'Error', failures: 1, people: 1, photos: 1 };

describe('isPattern', () => {
  it('leaves one person’s bad signal alone, and catches it when several share it', () => {
    expect(isPattern({ ...base, kind: 'Offline', people: 1, photos: 12 })).toBe(false);
    expect(isPattern({ ...base, kind: 'Offline', people: 3 })).toBe(true);
  });

  it('never files a file the person deleted', () => {
    expect(isPattern({ ...base, kind: 'SourceGone', people: 9, photos: 50 })).toBe(false);
  });

  it('files a refusal shared by two people, or one person’s whole selection', () => {
    expect(isPattern({ ...base, people: 1, photos: 1 })).toBe(false);
    expect(isPattern({ ...base, people: 2, photos: 2 })).toBe(true);
    expect(isPattern({ ...base, people: 1, photos: 12 })).toBe(true);
  });

  it('files any photo processing gave up on', () => {
    expect(isPattern({ ...base, source: 'server', stage: 'derive', kind: null })).toBe(true);
  });

  it('files never-confirmed uploads only when several people have them', () => {
    expect(isPattern({ ...base, source: 'server', stage: 'abandoned', kind: null, people: 2, photos: 30 })).toBe(false);
    expect(isPattern({ ...base, source: 'server', stage: 'abandoned', kind: null, people: 3 })).toBe(true);
  });
});

describe('device', () => {
  it('names a platform and browser, not the whole string', () => {
    expect(device(IPHONE)).toBe('iOS · Safari 18');
    expect(device(null)).toBeNull();
  });
});

describe('findPatterns', () => {
  it('groups by what went wrong and keeps to the window', async () => {
    const [a, b, c] = await people(3);
    await fail(a!);
    await fail(b!);
    await fail(c!, { createdAt: new Date(Date.now() - 7 * 3600_000) });
    await fail(c!, { error: 'something else' });

    const found = await findPatterns(db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ error: 'upload failed: 403', people: 2, devices: ['iOS · Safari 18'], types: ['image/jpeg'] });
  });

  it('puts nobody’s handle, name or browser string in the issue', async () => {
    const [a, b] = await people(2);
    await fail(a!, { cause: 'TypeError: Load failed' });
    await fail(b!);
    const [p] = await findPatterns(db);
    const { title, body } = issueFor(p!);
    expect(title + body).not.toMatch(/secret\.handle|Secret Name|Mozilla|AppleWebKit/);
    expect(body).toContain('TypeError: Load failed');
    expect(body).toContain(`upload-failure-fingerprint: ${p!.fingerprint}`);
  });
});

describe('fileIssues', () => {
  it('opens one issue per pattern, and none for a pattern already open', async () => {
    const [a, b] = await people(2);
    await fail(a!);
    await fail(b!);
    await fail(a!, { source: 'server', stage: 'derive', kind: null, error: 'unsupported image', client: null });
    const patterns = await findPatterns(db);
    expect(patterns).toHaveLength(2);

    const posted: { title: string; labels: string[] }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      if (!init?.method) {
        const open = [{ body: `…\n<!-- upload-failure-fingerprint: ${patterns[0]!.fingerprint} -->` }];
        return new Response(JSON.stringify(open));
      }
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ number: 40 + posted.length }), { status: 201 });
    }) as typeof fetch;

    const opened = await fileIssues(patterns, { token: 't', repo: 'o/r', fetch: fake });
    expect(opened).toEqual([41]);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.labels).toEqual(['upload-failure']);
  });
});
