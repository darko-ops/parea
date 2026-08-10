/**
 * What the app's home and profile tabs list — the albums someone can reach.
 *
 * The interesting decision is what *does not* appear. A link is a credential
 * someone was sent, not somewhere they live, so holding one is not enough to
 * put an album on a home screen; and a group member reaches events they have
 * never opened, which is what a group is for. Getting either wrong is quiet:
 * too little and the app looks empty to someone who is in things, too much
 * and it lists an album they opened once a year ago and forgot.
 */

import { PGlite } from '@electric-sql/pglite';
import { groupSlug, newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { albumsFor } from '../src/albums';
import type { Db } from '../src/db';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "observation", "photo", "rate_limit", "report", "safety_incident"
    restart identity cascade
  `);
});

async function actor() {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return row!.id;
}

async function event(
  createdBy: string,
  opts: { groupId?: string; place?: string; name?: string } = {},
) {
  const [row] = await db
    .insert(schema.events)
    .values({
      name: opts.name ?? 'Party',
      linkToken: newLinkToken(),
      createdBy,
      groupId: opts.groupId ?? null,
      place: opts.place ?? null,
    })
    .returning();
  return row!.id;
}

async function participates(eventId: string, actorId: string) {
  await db.insert(schema.eventParticipants).values({ eventId, actorId });
}

describe('what counts as reachable', () => {
  it('lists an album you took part in', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);

    expect((await albumsFor(db, person)).map((a) => a.id)).toEqual([id]);
  });

  it('lists every album in a group you are in, including ones you never opened', async () => {
    // The whole point of a group (§3): next Sunday's dinner reaches you
    // without anybody sending you anything.
    const person = await actor();
    const host = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Sunday roast', slug: groupSlug('Sunday roast') })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group!.id, actorId: person });
    const id = await event(host, { groupId: group!.id });

    expect((await albumsFor(db, person)).map((a) => a.id)).toEqual([id]);
  });

  it('does not list an album you merely could open with a link', async () => {
    // Holding a link is being sent something, not living somewhere. Listing
    // on that basis would pin an album someone opened once to their home
    // screen forever.
    const person = await actor();
    const stranger = await actor();
    await event(stranger);

    expect(await albumsFor(db, person)).toEqual([]);
  });

  it('lists nothing for someone with no actor yet', async () => {
    // Asked on launch, before anyone has contributed. Empty, not an error.
    expect(await albumsFor(db, null)).toEqual([]);
  });

  it('drops a deleted album', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.execute(sql`update "event" set deleted_at = now() where id = ${id}`);

    expect(await albumsFor(db, person)).toEqual([]);
  });

  it('does not list an album twice for someone who is both a member and a participant', async () => {
    const person = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group!.id, actorId: person });
    const id = await event(person, { groupId: group!.id });
    await participates(id, person);

    expect(await albumsFor(db, person)).toHaveLength(1);
  });
});

describe('what a card shows', () => {
  it('counts the people in it and the photos that finished ingest', async () => {
    const person = await actor();
    const other = await actor();
    const id = await event(person);
    await participates(id, person);
    await participates(id, other);

    await db.insert(schema.photos).values([
      { eventId: id, uploaderId: person, storageKey: 'a', byteSize: 1, mime: 'image/jpeg', status: 'ready' },
      // Not counted: still ingesting, and one that was removed.
      { eventId: id, uploaderId: person, storageKey: 'b', byteSize: 1, mime: 'image/jpeg', status: 'pending' },
      { eventId: id, uploaderId: other, storageKey: 'c', byteSize: 1, mime: 'image/jpeg', status: 'ready', deletedAt: new Date() },
    ]);

    const [album] = await albumsFor(db, person);
    expect(album!.memberCount).toBe(2);
    expect(album!.photoCount).toBe(1);
  });

  it('carries the place, for the map, and the group it belongs to', async () => {
    const person = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group!.id, actorId: person });
    await event(person, { groupId: group!.id, place: 'Hackney' });

    const [album] = await albumsFor(db, person);
    expect(album!.place).toBe('Hackney');
    expect(album!.groupName).toBe('Climbing');
  });

  it('carries the window, so an album opened from here still auto-selects', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.execute(
      sql`update "event" set starts_at = now(), ends_at = now() + interval '4 hours' where id = ${id}`,
    );

    const [album] = await albumsFor(db, person);
    expect(album!.startsAt).not.toBeNull();
    expect(album!.endsAt).not.toBeNull();
  });

  it('puts the most recently active first', async () => {
    const person = await actor();
    const older = await event(person, { name: 'Older' });
    const newer = await event(person, { name: 'Newer' });
    await participates(older, person);
    await participates(newer, person);
    await db.execute(
      sql`update "event" set last_active_at = now() - interval '2 days' where id = ${older}`,
    );

    expect((await albumsFor(db, person)).map((a) => a.name)).toEqual(['Newer', 'Older']);
  });
});

describe('the place a map is drawn from', () => {
  it('is never derived from a photo', async () => {
    // §7.6 strips GPS at ingest and the deriver *fails* a photo if any
    // survives, so there is no location in this system to derive from. A map
    // built on retained photo GPS would reverse a safety guarantee for a
    // nicety, and this asserts nobody quietly did.
    const schemaSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        fileURLToPath(new URL('../../../packages/core/src/schema.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(schemaSource).not.toMatch(/photo[\s\S]{0,600}?(latitude|longitude)/i);

    const route = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        fileURLToPath(new URL('../app/api/events/route.ts', import.meta.url)),
        'utf8',
      ),
    );
    // Typed by the host at creation, and nowhere else.
    expect(route).toMatch(/place:\s*\n?\s*typeof body\.place === 'string'/);
  });
});
