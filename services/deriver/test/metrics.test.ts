/**
 * The §18 report.
 *
 * Two things are worth asserting and they are not the arithmetic. First, that
 * the headline number means what the concept says it means — *does anyone
 * other than the creator upload?* — because an off-by-one there is a product
 * decision made on a wrong reading. Second, that an empty database produces a
 * report rather than a crash or a page of NaN, since that is the state it will
 * be run in first and a report that falls over on day one is never trusted
 * again.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { formatReport, report } from '../src/metrics';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "observation", "photo", "rate_limit", "report", "safety_incident"
    restart identity cascade
  `);
});

const find = (metrics: Awaited<ReturnType<typeof report>>, name: string) =>
  metrics.find((m) => m.name.startsWith(name))!;

async function actor() {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return row.id as string;
}

async function event(createdBy: string, opts: { window?: boolean } = {}) {
  const [row] = await db
    .insert(schema.events)
    .values({
      name: 'Party',
      linkToken: newLinkToken(),
      createdBy,
      startsAt: opts.window ? new Date('2026-07-18T18:00:00Z') : null,
      endsAt: opts.window ? new Date('2026-07-19T04:00:00Z') : null,
    })
    .returning();
  return row.id as string;
}

async function photo(eventId: string, uploaderId: string) {
  await db.insert(schema.photos).values({
    eventId,
    uploaderId,
    storageKey: `k-${Math.random()}`,
    byteSize: 1000,
    mime: 'image/jpeg',
    status: 'ready',
  });
}

describe('an empty deployment', () => {
  it('reports rather than crashing', async () => {
    // The state it is first run in. A report that divides by zero on day one
    // is a report nobody runs again.
    const metrics = await report(db);
    expect(metrics.length).toBeGreaterThan(8);
    for (const metric of metrics) {
      expect(metric.value, metric.name).not.toMatch(/NaN|Infinity|undefined|null/);
    }
    expect(formatReport(metrics)).toContain('events with a second contributor');
  });
});

describe('the headline', () => {
  it('does not count an event where only the creator uploaded', async () => {
    // The concept's own test. Counting the creator here would turn the
    // failure case into a success and there would be nothing to notice.
    const host = await actor();
    const id = await event(host);
    await photo(id, host);
    await photo(id, host);

    expect(find(await report(db), 'events with a second contributor').value).toContain('0/1');
  });

  it('counts one where somebody else did', async () => {
    const host = await actor();
    const guest = await actor();
    const id = await event(host);
    await photo(id, host);
    await photo(id, guest);

    const metrics = await report(db);
    expect(find(metrics, 'events with a second contributor').value).toContain('1/1');
    expect(find(metrics, 'mean contributors per event').value).toBe('2.0');
  });

  it('does not count a removed photo as a contribution', async () => {
    const host = await actor();
    const guest = await actor();
    const id = await event(host);
    await photo(id, host);
    await photo(id, guest);
    await db.execute(sql`update "photo" set deleted_at = now() where uploader_id = ${guest}`);

    expect(find(await report(db), 'events with a second contributor').value).toContain('0/1');
  });
});

describe('delivery', () => {
  it('is zero until something records a download', async () => {
    // Minting an archive leaves no other trace: the zip Worker has no
    // database. If this is not observed it is not known.
    const host = await actor();
    await event(host);
    expect(find(await report(db), 'events downloaded').value).toContain('0/1');
  });

  it('counts an event once however many times it is downloaded', async () => {
    const host = await actor();
    const id = await event(host);
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.observations).values({
        kind: 'download',
        eventId: id,
        client: 'web',
        count: 40,
      });
    }
    expect(find(await report(db), 'events downloaded').value).toContain('1/1');
  });
});

describe('the window §17 asked about', () => {
  it('reports the fraction of events whose creator set one', async () => {
    const host = await actor();
    await event(host, { window: true });
    await event(host);
    expect(find(await report(db), 'events with a creator-set window').value).toBe('50%');
  });
});

describe('auto-select', () => {
  it('measures precision against what was pre-selected, not what was offered', async () => {
    // Someone who adds photos the guess missed has not made the guess better.
    const person = await actor();
    const id = await event(person);
    await db.insert(schema.observations).values({
      kind: 'autoselect_confirmed',
      eventId: id,
      actorId: person,
      client: 'ios',
      count: 8,
      outOf: 10,
    });
    expect(find(await report(db), 'auto-select precision').value).toBe('80%');
  });

  it('separates a heavy deselector who came back from one who did not', async () => {
    // §18's companion metric, and the one that says whether low precision is
    // a tuning problem or the feature failing at its differentiated moment.
    const stayed = await actor();
    const left = await actor();
    const one = await event(stayed);
    const two = await event(stayed);

    for (const person of [stayed, left]) {
      await db.insert(schema.observations).values({
        kind: 'autoselect_confirmed',
        eventId: one,
        actorId: person,
        client: 'ios',
        count: 2,
        outOf: 40,
      });
    }
    // Only one of them contributed to a second event.
    await photo(one, stayed);
    await photo(two, stayed);
    await photo(one, left);

    expect(find(await report(db), 'heavy deselectors who came back').value).toContain('1/2');
  });

  it('ignores someone who kept most of the suggestion', async () => {
    const person = await actor();
    const id = await event(person);
    await db.insert(schema.observations).values({
      kind: 'autoselect_confirmed',
      eventId: id,
      actorId: person,
      client: 'ios',
      count: 38,
      outOf: 40,
    });
    expect(find(await report(db), 'heavy deselectors who came back').value).toBe('none yet');
  });
});

describe('which client', () => {
  it('splits joins by client, which is the install-conversion question', async () => {
    const host = await actor();
    const id = await event(host);
    for (const client of ['web', 'web', 'web', 'ios'] as const) {
      await db.insert(schema.observations).values({ kind: 'joined', eventId: id, client });
    }
    const value = find(await report(db), 'joins by client').value;
    expect(value).toContain('web 75%');
    expect(value).toContain('ios 25%');
  });
});
