/**
 * What the app's home and profile tabs list — the events someone can reach.
 *
 * The interesting decision is what *does not* appear. A link is a credential
 * someone was sent, not somewhere they live, so holding one is not enough to
 * put an event on a home screen; and a group member reaches events they have
 * never opened, which is what a group is for. Getting either wrong is quiet:
 * too little and the app looks empty to someone who is in things, too much
 * and it lists an event they opened once a year ago and forgot.
 */

import { PGlite } from '@electric-sql/pglite';
import { groupSlug, newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MOSAIC_TILES, eventsFor, leaveEvent } from '../src/events';
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
  it('lists an event you took part in', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);

    expect((await eventsFor(db, person)).map((a) => a.id)).toEqual([id]);
  });

  it('lists every event in a group you are in, including ones you never opened', async () => {
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

    expect((await eventsFor(db, person)).map((a) => a.id)).toEqual([id]);
  });

  it('does not list an event you merely could open with a link', async () => {
    // Holding a link is being sent something, not living somewhere. Listing
    // on that basis would pin an event someone opened once to their home
    // screen forever.
    const person = await actor();
    const stranger = await actor();
    await event(stranger);

    expect(await eventsFor(db, person)).toEqual([]);
  });

  it('lists nothing for someone with no actor yet', async () => {
    // Asked on launch, before anyone has contributed. Empty, not an error.
    expect(await eventsFor(db, null)).toEqual([]);
  });

  it('drops a deleted event', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.execute(sql`update "event" set deleted_at = now() where id = ${id}`);

    expect(await eventsFor(db, person)).toEqual([]);
  });

  it('does not list an event twice for someone who is both a member and a participant', async () => {
    const person = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group!.id, actorId: person });
    const id = await event(person, { groupId: group!.id });
    await participates(id, person);

    expect(await eventsFor(db, person)).toHaveLength(1);
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

    const [listing] = await eventsFor(db, person);
    expect(listing!.memberCount).toBe(2);
    expect(listing!.photoCount).toBe(1);
  });

  it('carries the place, for the map, and the group it belongs to', async () => {
    const person = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group!.id, actorId: person });
    await event(person, { groupId: group!.id, place: 'Hackney' });

    const [listing] = await eventsFor(db, person);
    expect(listing!.place).toBe('Hackney');
    expect(listing!.groupName).toBe('Climbing');
  });

  it('carries the window, so an event opened from here still auto-selects', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.execute(
      sql`update "event" set starts_at = now(), ends_at = now() + interval '4 hours' where id = ${id}`,
    );

    const [listing] = await eventsFor(db, person);
    expect(listing!.startsAt).not.toBeNull();
    expect(listing!.endsAt).not.toBeNull();
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

    expect((await eventsFor(db, person)).map((a) => a.name)).toEqual(['Newer', 'Older']);
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

describe('the photos the card leads with', () => {
  /*
   * The card is photo-led, so the list has to carry photos. Fetched in the
   * same statement as the list — a query per card is N+1 on exactly the screen
   * that grows as someone uses the product.
   */
  // Distinct hashes per photo, because `photo_event_hash_idx` is unique on
  // (event_id, content_hash) — the dedup rule that stops one photo appearing
  // twice in an event. A fixture that reuses one hash is testing against a
  // schema that does not exist.
  let nth = 0;
  const photo = (
    eventId: string,
    uploaderId: string,
    key: string,
    at: string,
    over: Record<string, unknown> = {},
  ) => ({
    eventId,
    uploaderId,
    storageKey: key,
    byteSize: 1,
    mime: 'image/jpeg',
    status: 'ready' as const,
    uploadedAt: new Date(at),
    contentHash: Buffer.from(String(nth++).padStart(2, '0').repeat(16), 'hex'),
    ...over,
  });

  it('returns the most recent first, capped', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.insert(schema.photos).values(
      Array.from({ length: MOSAIC_TILES + 3 }, (_, i) =>
        photo(id, person, `k${i}`, `2026-08-0${i + 1}T12:00:00Z`),
      ),
    );

    const [listing] = await eventsFor(db, person);
    expect(listing!.mosaic).toHaveLength(MOSAIC_TILES);
    // Newest first: the tiles are meant to show what just went in.
    expect(listing!.mosaic[0]!.storageKey).toBe(`k${MOSAIC_TILES + 2}`);
  });

  it('leaves out what the grid leaves out', async () => {
    // Same predicate the event view uses. A card that previewed a photo the
    // event itself will not show would be a leak with a thumbnail on it.
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.insert(schema.photos).values([
      photo(id, person, 'ready', '2026-08-01T12:00:00Z'),
      photo(id, person, 'pending', '2026-08-02T12:00:00Z', { status: 'pending' }),
      photo(id, person, 'deleted', '2026-08-03T12:00:00Z', { deletedAt: new Date() }),
    ]);

    const [listing] = await eventsFor(db, person);
    expect(listing!.mosaic.map((p) => p.storageKey)).toEqual(['ready']);
  });

  it('drops a photo with no hash rather than offering an unbuildable URL', async () => {
    // No content hash means no derivatives, so there is no thumbnail to
    // address. Keeping the row would put a broken tile on the card.
    const person = await actor();
    const id = await event(person);
    await participates(id, person);
    await db.insert(schema.photos).values([
      photo(id, person, 'hashed', '2026-08-01T12:00:00Z'),
      photo(id, person, 'unhashed', '2026-08-02T12:00:00Z', { contentHash: null }),
    ]);

    const [listing] = await eventsFor(db, person);
    expect(listing!.mosaic.map((p) => p.storageKey)).toEqual(['hashed']);
    expect(listing!.mosaic[0]!.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is an empty array for an event nobody has added to', async () => {
    const person = await actor();
    const id = await event(person);
    await participates(id, person);

    const [listing] = await eventsFor(db, person);
    expect(listing!.mosaic).toEqual([]);
    expect(listing!.capEpoch).toBeGreaterThan(0);
  });
});

/**
 * Leaving one, which is the same rule read backwards.
 *
 * Everything above is about the two ways an event reaches a home screen. This
 * is what happens when somebody wants it off theirs — and the reason it is
 * worth a test rather than a one-line delete is that removing a participant row
 * only closes one of the two doors.
 */
describe('leaving an event', () => {
  it('takes it off the list', async () => {
    const person = await actor();
    const host = await actor();
    const id = await event(host);
    await participates(id, person);

    expect(await leaveEvent(db, id, person)).toEqual({
      left: true,
      wasIn: true,
      throughGroup: null,
    });
    expect(await eventsFor(db, person)).toEqual([]);
  });

  it('leaves the photographs where they are', async () => {
    /*
     * They belong to the evening rather than to whoever carried them there. A
     * roomful of people losing an hour of their lives because one of them
     * tidied up is the failure this pins — and it is the same call the account
     * deletion makes, where the actor survives as a guest and keeps its
     * uploads.
     */
    const person = await actor();
    const host = await actor();
    const id = await event(host);
    await participates(id, person);
    const [photo] = await db
      .insert(schema.photos)
      .values({
        eventId: id,
        uploaderId: person,
        storageKey: 'k/1',
        mime: 'image/jpeg',
        byteSize: 1024,
        status: 'ready',
      })
      .returning();

    await leaveEvent(db, id, person);

    const left = await db.select().from(schema.photos);
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(photo!.id);
    // And still theirs. Orphaning the upload would be a quieter way of
    // throwing it away — nobody could be asked to take it down.
    expect(left[0]!.uploaderId).toBe(person);
  });

  it('says so when the album is in a group they are in', async () => {
    /*
     * The participant row was never what put this on their home screen. The
     * group membership was, and it still does — so deleting the row and
     * reporting plain success is a lie somebody discovers by pulling to
     * refresh. The caller is told which door it is still coming through.
     */
    const person = await actor();
    const host = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group!.id, actorId: person });
    const id = await event(host, { groupId: group!.id });
    await participates(id, person);

    expect(await leaveEvent(db, id, person)).toEqual({
      left: true,
      wasIn: true,
      throughGroup: group!.id,
    });
    expect((await eventsFor(db, person)).map((a) => a.id)).toEqual([id]);
  });

  it('does not report a group they are not in', async () => {
    // The event belongs to one; this person does not. Saying "it is still on
    // your list through Climbing" to somebody who is not in Climbing would be
    // both wrong and a small leak about a group they cannot see.
    const person = await actor();
    const host = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    const id = await event(host, { groupId: group!.id });
    await participates(id, person);

    expect(await leaveEvent(db, id, person)).toEqual({
      left: true,
      wasIn: true,
      throughGroup: null,
    });
    expect(await eventsFor(db, person)).toEqual([]);
  });

  it('touches nobody else', async () => {
    const person = await actor();
    const other = await actor();
    const host = await actor();
    const id = await event(host);
    await participates(id, person);
    await participates(id, other);

    await leaveEvent(db, id, person);
    expect((await eventsFor(db, other)).map((a) => a.id)).toEqual([id]);
  });

  it('is quiet about somebody who was never in it', async () => {
    // Left on another device, or never joined at all: either way they are
    // already where they asked to be, and a failure here would be a report
    // about a state they wanted.
    const person = await actor();
    const host = await actor();
    const id = await event(host);

    expect(await leaveEvent(db, id, person)).toEqual({
      left: true,
      wasIn: false,
      throughGroup: null,
    });
  });

  it('refuses the host, who means delete', async () => {
    /*
     * An album whose host has left is not a room somebody left — it is one with
     * no way back in: nobody to answer a request to join, nobody to change who
     * can see it. The action they mean is one tap away in the same sheet, and
     * the app never offers this one to them.
     */
    const host = await actor();
    const id = await event(host);
    await participates(id, host);

    expect(await leaveEvent(db, id, host)).toEqual({ left: false, reason: 'host' });
    expect((await eventsFor(db, host)).map((a) => a.id)).toEqual([id]);
  });

  it('says not_found for an event that is not there', async () => {
    const person = await actor();
    expect(
      await leaveEvent(db, '00000000-0000-0000-0000-000000000000', person),
    ).toEqual({ left: false, reason: 'not_found' });
  });
});

/**
 * Which photographs this viewer kept, and the hole that hid them.
 *
 * The feed carries a `favourite` flag per photograph, read once for the page
 * and scoped to the viewer. It reported false for everything while the writes
 * were succeeding, and the cause was a stray second comma in the array of
 * parallel reads: `[a, , b]` is an elided element, so the destructured name
 * took the hole, the query landed one slot further along where nothing read
 * it, and it ran on every load with its result discarded.
 *
 * TypeScript said the name was possibly undefined — which was the hole
 * speaking — and a `?? []` silenced it rather than answering it.
 */
describe('the feed says which photographs were kept', () => {
  const ROUTE = readFileSync(
    fileURLToPath(new URL('../app/api/events/[id]/photos/route.ts', import.meta.url)),
    'utf8',
  );

  it('destructures as many names as the array has entries', () => {
    /*
     * The real check, and the one a type error cannot make: an elision is
     * valid JavaScript and valid TypeScript, so nothing but counting catches
     * it. Commas inside the comments are why this counts bracket depth rather
     * than splitting on them.
     */
    const open = ROUTE.indexOf('  ] = await Promise.all([');
    const names = ROUTE.slice(ROUTE.indexOf('  const [\n    hasCard,') + 9, open)
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean);

    const body = ROUTE.slice(ROUTE.indexOf('[', open) + 1, ROUTE.indexOf('\n  ]);', open));
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    let depth = 0;
    let entries = 1;
    let holes = 0;
    let sinceComma = '';
    for (const ch of stripped) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) {
        if (sinceComma.trim() === '') holes++;
        entries++;
        sinceComma = '';
        continue;
      }
      sinceComma += ch;
    }
    if (sinceComma.trim() === '') entries--;

    expect(holes, 'an elided element: two commas in a row').toBe(0);
    expect(entries).toBe(names.length);
  });

  it('reads the flag off the query rather than around it', () => {
    // The fallback that hid the hole. Its absence is the assertion.
    expect(ROUTE).toMatch(/const keptIds = new Set\(kept\.map\(\(row\) => row\.photoId\)\);/);
    expect(ROUTE).toMatch(/favourite: keptIds\.has\(photo\.id\)/);
  });

  it('scopes it to the viewer and to this page', () => {
    expect(ROUTE).toMatch(/eq\(schema\.photoFavourites\.actorId, viewerId\)/);
    expect(ROUTE).toMatch(/inArray\(schema\.photoFavourites\.photoId, photoIds\)/);
  });
});
