/**
 * The 72-hour reporting clock on child-safety incidents.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';
import { hoursLeft, stageFor } from '@/reportDeadline';

const captured: string[] = [];
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (m: string) => void captured.push(m),
  flush: async () => true,
}));

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock('@parea/core', async (original) => ({
  ...(await original<typeof import('@parea/core')>()),
  mailerFromEnv: () => ({ send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }),
}));

const { __setDbForTests } = await import('@/db');
const { GET } = await import('../app/api/cron/safety-deadlines/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "safety_incident", "actor" restart identity cascade`);
  process.env.CRON_SECRET = 'cron-secret';
  process.env.SAFETY_ALERT_EMAIL = 'safety@example.test';
  sent.length = 0;
  captured.length = 0;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.SAFETY_ALERT_EMAIL;
});

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

async function incident(hoursAgo: number, extra: Partial<typeof schema.safetyIncidents.$inferInsert> = {}) {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [row] = await db
    .insert(schema.safetyIncidents)
    .values({
      uploaderActorId: actor!.id,
      provider: 'photodna',
      classification: 'match',
      storageKey: 'preserved/x',
      detectedAt: ago(hoursAgo),
      ...extra,
    })
    .returning();
  return row!.id;
}

const tick = () =>
  GET(new Request('https://parea.test/api/cron/safety-deadlines', {
    headers: { authorization: 'Bearer cron-secret' },
  }));

describe('stageFor', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() - h * HOUR);

  it('is quiet for the first day — the responder was told at detection', () => {
    expect(stageFor(at(1), now)).toBeNull();
    expect(stageFor(at(23.9), now)).toBeNull();
  });

  it('reminds once, a day in', () => {
    expect(stageFor(at(24.5), now)).toBe('first');
    expect(stageFor(at(25.5), now)).toBeNull();
  });

  it('says it every hour from two days, and then that it is late', () => {
    expect(stageFor(at(48), now)).toBe('urgent');
    expect(stageFor(at(71.9), now)).toBe('urgent');
    expect(stageFor(at(72), now)).toBe('overdue');
    expect(hoursLeft(at(50), now)).toBe(22);
  });
});

describe('the hourly check', () => {
  it('refuses anybody but the scheduler', async () => {
    const res = await GET(new Request('https://parea.test/api/cron/safety-deadlines'));
    expect(res.status).toBe(404);
  });

  it('emails the safety address about an incident two days old', async () => {
    const id = await incident(50);
    const res = await tick();
    expect((await res.json()).reminded).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('safety@example.test');
    expect(sent[0]!.text).toContain(id);
    expect(sent[0]!.text).toMatch(/21h left|22h left/);
    expect(captured).toHaveLength(1);
  });

  it('says overdue past 72 hours', async () => {
    await incident(80);
    await tick();
    expect(sent[0]!.subject).toMatch(/past the 72-hour reporting deadline/);
  });

  it('stops once reported, or released as a false match', async () => {
    await incident(50, { reportedAt: new Date(), reportReference: 'CT-1' });
    await incident(50, { releasedAt: new Date() });
    const res = await tick();
    expect((await res.json()).reminded).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('is scheduled hourly', () => {
    const config = JSON.parse(
      readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
    ) as { crons: { path: string; schedule: string }[] };
    expect(config.crons).toContainEqual({ path: '/api/cron/safety-deadlines', schedule: '40 * * * *' });
  });
});
