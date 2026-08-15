/**
 * The feed, and being finished with a line of it.
 *
 * Hiding is the one piece of state a derived feed can hold, and it is held by
 * a string rather than by a row: there is no notification table to mark, so
 * what `hidden_activity` stores is the key `activity.ts` composes when it
 * builds the line. That indirection is the whole risk. If the key a line is
 * built with and the key the route stores ever drift apart, hiding silently
 * stops working — the row is written, the line comes back, and nothing fails.
 *
 * So these tests hide things the way the screen does: by taking the id off the
 * item the feed produced.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activityFor } from '@/activity';
import type { Db } from '@/db';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "event", "event_participant",
      "event_access_request", "event_message", "message_reaction",
      "hidden_activity"
    restart identity cascade
  `);
});

async function actor(handle?: string) {
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle: handle ?? null })
    .returning();
  return row!.id;
}

async function event(createdBy: string, name = 'Party') {
  const [row] = await db
    .insert(schema.events)
    .values({ name, linkToken: newLinkToken(), createdBy })
    .returning();
  return row!;
}

/** Two albums somebody else made, which this actor was let into. */
async function twoLines(me: string) {
  const host = await actor('host');
  for (const name of ['One', 'Two']) {
    const made = await event(host, name);
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
  }
}

const hide = (actorId: string, itemKey: string) =>
  db.insert(schema.hiddenActivity).values({ actorId, itemKey });

describe('hiding a line', () => {
  it('takes it out of the feed, and leaves the rest', async () => {
    const me = await actor('me');
    await twoLines(me);

    const before = await activityFor(db, me);
    expect(before).toHaveLength(2);

    await hide(me, before[0]!.id);
    const after = await activityFor(db, me);
    expect(after.map((i) => i.id)).toEqual([before[1]!.id]);
  });

  it('is keyed by the id the feed hands the screen', async () => {
    /*
     * The failure this exists for: the feed builds `letin:<eventId>` and the
     * route stores whatever the client sent. If either side ever composes the
     * key differently, the row is written and the line comes back — a silent
     * no-op, because nothing on either side can tell that a key matches
     * nothing.
     */
    const me = await actor('me');
    await twoLines(me);
    const [first] = await activityFor(db, me);

    await hide(me, first!.id);
    expect((await activityFor(db, me)).some((i) => i.id === first!.id)).toBe(false);
  });

  it('is one person’s decision, not everybody’s', async () => {
    // The key names a line, and two people can be shown the same line — being
    // let into the same album, on the same day, by the same host.
    const me = await actor('me');
    const you = await actor('you');
    const host = await actor('host');
    const made = await event(host, 'Shared');
    await db
      .insert(schema.eventParticipants)
      .values([
        { eventId: made.id, actorId: me },
        { eventId: made.id, actorId: you },
      ]);

    const mine = await activityFor(db, me);
    await hide(me, mine[0]!.id);

    expect(await activityFor(db, me)).toHaveLength(0);
    expect(await activityFor(db, you)).toHaveLength(1);
  });

  it('does nothing at all for a key that names no line', async () => {
    // The route cannot check that a key is real — the line has no row — so an
    // arbitrary string has to be harmless rather than rejected.
    const me = await actor('me');
    await twoLines(me);
    await hide(me, 'letin:00000000-0000-0000-0000-000000000000');
    expect(await activityFor(db, me)).toHaveLength(2);
  });

  it('survives being asked twice', async () => {
    // Two tabs, or one impatient tap on a slow connection.
    const me = await actor('me');
    await twoLines(me);
    const [first] = await activityFor(db, me);

    await hide(me, first!.id);
    await db
      .insert(schema.hiddenActivity)
      .values({ actorId: me, itemKey: first!.id })
      .onConflictDoNothing();

    expect(await activityFor(db, me)).toHaveLength(1);
  });
});
