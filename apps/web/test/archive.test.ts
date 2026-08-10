/**
 * What ends up in a download — `resolveArchive`, design §7.7 and §10.
 *
 * The interesting property is not "the JPEG archive contains JPEGs". It is
 * that both archives are *complete or refused*: an archive with an exact
 * Content-Length is only honest if every member's size and CRC were known
 * before a byte was read, and the failure mode of getting that wrong is a
 * download that looks finished and is missing photos.
 *
 * The other half is which object each entry points at, because "download as
 * JPEG" is a substitution and substitutions are where quiet quality loss
 * hides.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveArchive } from '../src/archive';

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
      "groups", "photo", "report", "safety_incident"
    restart identity cascade
  `);
});

async function scene() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  return { actor: actor.id, event: event.id };
}

let clock = 0;

/** A photo that finished ingest, with its `full` derivative, as the deriver leaves it. */
async function photo(
  eventId: string,
  actorId: string,
  opts: {
    mime?: string;
    bytes?: number;
    crc32?: number | null;
    /** null: no derivative row at all. Otherwise its size and CRC. */
    derivative?: { bytes: number; crc32: number | null } | null;
    status?: string;
    deleted?: boolean;
  } = {},
) {
  const key = `ev/${eventId}/${(clock += 1).toString(16).padStart(8, '0')}`;
  const [row] = await db
    .insert(schema.photos)
    .values({
      eventId,
      uploaderId: actorId,
      storageKey: key,
      byteSize: opts.bytes ?? 4_000_000,
      crc32: opts.crc32 === undefined ? 0x1111_1111 : opts.crc32,
      mime: opts.mime ?? 'image/heic',
      status: (opts.status ?? 'ready') as 'ready',
      // Ordering is by capture time, so each photo needs a distinct one.
      capturedAt: new Date(Date.UTC(2026, 6, 18, 20, clock)),
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning();

  const derivative = opts.derivative === undefined
    ? { bytes: 900_000, crc32: 0x2222_2222 }
    : opts.derivative;
  if (derivative) {
    await db.insert(schema.derivatives).values({
      photoId: row.id,
      kind: 'full',
      storageKey: `${key}.full.jpg`,
      width: 2560,
      height: 1920,
      mime: 'image/jpeg',
      byteSize: derivative.bytes,
      crc32: derivative.crc32,
    });
  }
  return { id: row.id, key };
}

describe('originals', () => {
  it('archives the object the camera produced, under its own extension', async () => {
    const { actor, event } = await scene();
    const { key } = await photo(event, actor, { mime: 'image/heic' });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'original',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.key).toBe(key);
    expect(result.entries[0]!.name).toMatch(/\.heic$/);
    // Nothing was substituted, so the two buttons would differ here.
    expect(result.converted).toBe(0);
  });

  it('is unaffected by a derivative that has no size recorded', async () => {
    // Only the JPEG path reads those columns. An old derivative row must not
    // make the originals download — the product's actual promise — refuse.
    const { actor, event } = await scene();
    await photo(event, actor, { derivative: { bytes: 900_000, crc32: null } });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'original',
    });
    expect(result.ok).toBe(true);
  });
});

describe('as JPEG', () => {
  it('substitutes the full derivative for a HEIC original', async () => {
    const { actor, event } = await scene();
    const { key } = await photo(event, actor, {
      mime: 'image/heic',
      bytes: 4_000_000,
      derivative: { bytes: 900_000, crc32: 0x2222_2222 },
    });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'jpeg',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0]!.key).toBe(`${key}.full.jpg`);
    expect(result.entries[0]!.name).toMatch(/\.jpg$/);
    // The derivative's size and CRC, not the original's — getting this wrong
    // produces an archive whose Content-Length is a lie and whose CRCs fail.
    expect(result.entries[0]!.size).toBe(900_000);
    expect(result.entries[0]!.crc32).toBe(0x2222_2222);
    expect(result.totalBytes).toBe(900_000);
    expect(result.converted).toBe(1);
  });

  it('passes a JPEG original through at full resolution', async () => {
    // The ask is "files that open", not "smaller files". Re-encoding a JPEG
    // down to 2560px to satisfy a format request it already satisfies would be
    // quality lost for nothing.
    const { actor, event } = await scene();
    const { key } = await photo(event, actor, {
      mime: 'image/jpeg',
      bytes: 4_000_000,
      crc32: 0x1111_1111,
    });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'jpeg',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0]!.key).toBe(key);
    expect(result.entries[0]!.size).toBe(4_000_000);
    expect(result.converted, 'nothing was converted, and the count says so').toBe(0);
  });

  it('refuses when a photo has no full derivative', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, { derivative: { bytes: 900_000, crc32: 0x2222_2222 } });
    await photo(event, actor, { derivative: null });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'jpeg',
    });

    // Not "archive the one that works". A download missing a photo is worse
    // than a download that did not start, because nobody notices the first.
    expect(result).toEqual({ ok: false, error: 'jpeg_unavailable', count: 1 });
  });

  it('refuses when a derivative predates size and CRC being recorded', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, { derivative: { bytes: 900_000, crc32: null } });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'jpeg',
    });
    expect(result).toEqual({ ok: false, error: 'jpeg_unavailable', count: 1 });
  });

  it('reports not_ready, not jpeg_unavailable, when the original is the gap', async () => {
    // A JPEG original with no CRC fails on the originals path too, and the
    // remedy is waiting rather than pressing the other button. Naming it
    // jpeg_unavailable would send someone to a download that also refuses.
    const { actor, event } = await scene();
    await photo(event, actor, { mime: 'image/jpeg', crc32: null });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'jpeg',
    });
    expect(result).toEqual({ ok: false, error: 'not_ready', count: 1 });
  });
});

describe('what is in scope either way', () => {
  it('leaves out photos that have not finished ingest', async () => {
    // The `ready` gate: an un-stripped original must not reach a download.
    const { actor, event } = await scene();
    await photo(event, actor, { status: 'pending' });
    await photo(event, actor, { status: 'quarantined' });
    await photo(event, actor, { mime: 'image/jpeg' });

    for (const format of ['original', 'jpeg'] as const) {
      const result = await resolveArchive(db, event, { selection: 'all', format });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.entries).toHaveLength(1);
    }
  });

  it('leaves out tombstoned photos', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, { deleted: true });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'original',
    });
    expect(result.ok && result.entries).toHaveLength(0);
  });

  it('numbers entries in capture order, so extraction matches the grid', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, { mime: 'image/jpeg' });
    await photo(event, actor, { mime: 'image/jpeg' });
    await photo(event, actor, { mime: 'image/jpeg' });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'jpeg',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((e) => e.name.slice(0, 4))).toEqual([
      '0001',
      '0002',
      '0003',
    ]);
    const times = result.entries.map((e) => e.takenAt);
    expect([...times].sort()).toEqual(times);
  });

  it('honours a selection', async () => {
    const { actor, event } = await scene();
    const first = await photo(event, actor, { mime: 'image/jpeg' });
    await photo(event, actor, { mime: 'image/jpeg' });

    const result = await resolveArchive(db, event, {
      selection: [first.id],
      format: 'original',
    });
    expect(result.ok && result.entries.map((e) => e.key)).toEqual([first.key]);
  });

  it('does not reach into another event', async () => {
    const { actor, event } = await scene();
    const other = await scene();
    await photo(other.event, other.actor, { mime: 'image/jpeg' });

    const result = await resolveArchive(db, event, {
      selection: 'all',
      format: 'original',
    });
    expect(result.ok && result.entries).toHaveLength(0);
  });
});
