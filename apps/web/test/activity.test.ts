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
      "friend_request", "photo", "hidden_activity"
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

describe('one act, one line', () => {
  it('does not say both that you were let in and that you can see it', async () => {
    /*
     * Approving a request writes the participant row. So a single act by a
     * host produced two rows in two tables and two lines on this page, one
     * directly under the other, saying the same thing in two registers —
     * which reads as the product telling you twice because it is not sure you
     * heard. The approval is the one that knows a person decided.
     */
    const me = await actor('me');
    const host = await actor('host');
    const made = await event(host, 'Ultra');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    await db.insert(schema.eventAccessRequests).values({
      eventId: made.id,
      actorId: me,
      status: 'approved',
      resolvedAt: new Date(),
    } as never);

    const items = await activityFor(db, me);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'request_answered',
      who: 'You',
      what: 'can see Ultra now',
    });
  });

  it('still says you joined an album nobody had to approve you into', async () => {
    // The link-open case, which is most of them: no request was ever made, so
    // there is nothing else to speak for it.
    const me = await actor('me');
    await twoLines(me);

    const items = await activityFor(db, me);
    expect(items.map((i) => i.what).sort()).toEqual(['joined One', 'joined Two']);
    expect(items.every((i) => i.who === 'You')).toBe(true);
  });

  it('says nothing about a no, which the panel above already holds', async () => {
    // `askedToJoin` keeps a declined request permanently and shows it as "Not
    // this time" at the top of the same page — deliberately, so a request that
    // was refused does not read as one that was never sent. A line down here
    // would be that fact twice on one screen.
    const me = await actor('me');
    const host = await actor('host');
    const made = await event(host, 'Ultra');
    await db.insert(schema.eventAccessRequests).values({
      eventId: made.id,
      actorId: me,
      status: 'declined',
      resolvedAt: new Date(),
    } as never);

    expect(await activityFor(db, me)).toEqual([]);
  });
});

describe('photographs arriving', () => {
  async function photo(eventId: string, uploaderId: string, at: Date, n: number) {
    await db.insert(schema.photos).values({
      eventId,
      uploaderId,
      storageKey: `ev/${eventId}/${n}`,
      byteSize: 1,
      mime: 'image/jpeg',
      status: 'ready',
      uploadedAt: at,
    });
  }

  it('is one line for the fifteen somebody added, not fifteen', async () => {
    /*
     * An album fills up after the evening, in bursts. A row per photograph is
     * a page that has to be scrolled past rather than read, and it buries the
     * other kinds of line under whichever album was busiest.
     */
    const me = await actor('me');
    const sarah = await actor('sarah');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const at = new Date();
    for (let i = 0; i < 15; i++) await photo(made.id, sarah, at, i);

    const items = await activityFor(db, me);
    expect(items.filter((i) => i.kind === 'photos_added')).toHaveLength(1);
    expect(items.find((i) => i.kind === 'photos_added')).toMatchObject({
      who: '@sarah',
      what: 'added 15 photos to Dinner',
    });
  });

  it('counts one photograph as one photo', async () => {
    const me = await actor('me');
    const sarah = await actor('sarah');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    await photo(made.id, sarah, new Date(), 0);

    const items = await activityFor(db, me);
    expect(items.find((i) => i.kind === 'photos_added')?.what).toBe(
      'added 1 photo to Dinner',
    );
  });

  it('separates two people and two days', async () => {
    // The key carries the day, so tomorrow's photographs are a new line rather
    // than yesterday's line quietly growing a bigger number under the same id
    // — which would make a line somebody hid stay hidden for the new ones too.
    const me = await actor('me');
    const sarah = await actor('sarah');
    const marcus = await actor('marcus');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });

    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    await photo(made.id, sarah, today, 0);
    await photo(made.id, sarah, yesterday, 1);
    await photo(made.id, marcus, today, 2);

    const lines = (await activityFor(db, me)).filter((i) => i.kind === 'photos_added');
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((l) => l.id)).size).toBe(3);
  });

  it('says nothing about your own photographs, or an album you are not in', async () => {
    const me = await actor('me');
    const stranger = await actor('stranger');
    const mine = await event(me, 'Mine');
    await db.insert(schema.eventParticipants).values({ eventId: mine.id, actorId: me });
    await photo(mine.id, me, new Date(), 0);

    const theirs = await event(stranger, 'Theirs');
    await photo(theirs.id, stranger, new Date(), 1);

    expect((await activityFor(db, me)).filter((i) => i.kind === 'photos_added')).toEqual(
      [],
    );
  });

  it('forgets a month-old burst, and a deleted photograph', async () => {
    const me = await actor('me');
    const sarah = await actor('sarah');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });

    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await photo(made.id, sarah, old, 0);

    await db.insert(schema.photos).values({
      eventId: made.id,
      uploaderId: sarah,
      storageKey: `ev/${made.id}/gone`,
      byteSize: 1,
      mime: 'image/jpeg',
      status: 'ready',
      deletedAt: new Date(),
    });

    expect((await activityFor(db, me)).filter((i) => i.kind === 'photos_added')).toEqual(
      [],
    );
  });
});

describe('being said yes to', () => {
  const asks = (from: string, to: string, status = 'open', resolvedAt: Date | null = null) =>
    db
      .insert(schema.friendRequests)
      .values({ fromActorId: from, toActorId: to, status, resolvedAt } as never);

  it('tells the person who asked', async () => {
    /*
     * The line this page was missing. A friend request is answered in the
     * bubble at the top, and answering it takes the row out of the answerer's
     * queue — which left the *asker* with nothing at all: their question left
     * one list and joined no other, so being said yes to looked exactly like
     * never being answered.
     */
    const me = await actor('me');
    const them = await actor('wren');
    await asks(me, them, 'accepted', new Date());

    const items = await activityFor(db, me);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'friend_accepted',
      who: 'You',
      what: 'and @wren are friends now',
      href: '/u/wren',
    });
  });

  it('does not tell the person who pressed Accept', async () => {
    // They were there. Telling somebody what they have just done is the
    // product confirming its own button.
    const me = await actor('me');
    const them = await actor('wren');
    await asks(them, me, 'accepted', new Date());

    expect(await activityFor(db, me)).toEqual([]);
  });

  it('says nothing about one still waiting, or one refused', async () => {
    // Open belongs in the bubble, where it can be answered. A refusal is the
    // refuser's to say, and this page never says it — see `requests.ts`.
    const me = await actor('me');
    const open = await actor('open');
    const no = await actor('no');
    await asks(me, open);
    await asks(me, no, 'declined', new Date());

    expect(await activityFor(db, me)).toEqual([]);
  });
});

describe('somebody arriving in an album you made', () => {
  it('tells the host, who otherwise hears nothing back', async () => {
    /*
     * The other half of `let_in`, which has always said when *you* were let
     * into somebody else's. A host invites four people and hears nothing until
     * photographs appear — and if none do, never learns whether anybody opened
     * it.
     */
    const me = await actor('me');
    const them = await actor('wren');
    const mine = await event(me, 'Barcelona');
    await db.insert(schema.eventParticipants).values({ eventId: mine.id, actorId: them });

    const items = await activityFor(db, me);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'joined_yours',
      who: '@wren',
      what: 'joined Barcelona',
    });
  });

  it('says nothing about the ones you let in yourself', async () => {
    // Approving a request writes the participant row, so without this the host
    // who pressed "Let in" is told a second later that the person they let in
    // has joined.
    const me = await actor('me');
    const them = await actor('wren');
    const mine = await event(me, 'Barcelona');
    await db.insert(schema.eventParticipants).values({ eventId: mine.id, actorId: them });
    await db.insert(schema.eventAccessRequests).values({
      eventId: mine.id,
      actorId: them,
      status: 'approved',
      resolvedAt: new Date(),
    } as never);

    expect(await activityFor(db, me)).toEqual([]);
  });

  it('says nothing about your own arrival, or about somebody else’s album', async () => {
    const me = await actor('me');
    const host = await actor('host');
    const mine = await event(me, 'Mine');
    await db.insert(schema.eventParticipants).values({ eventId: mine.id, actorId: me });

    const theirs = await event(host, 'Theirs');
    const stranger = await actor('stranger');
    await db
      .insert(schema.eventParticipants)
      .values({ eventId: theirs.id, actorId: stranger });

    expect(await activityFor(db, me)).toEqual([]);
  });
});

describe('how much of the past is shown', () => {
  it('stops at fifty, newest first', async () => {
    /*
     * A list somebody scans, not an archive they read. Fifty-one albums is a
     * contrived number and the test is not: the bound is the only thing
     * standing between this page and a query whose cost grows with how long
     * somebody has used the product.
     */
    const me = await actor('me');
    const host = await actor('host');
    for (let i = 0; i < 55; i++) {
      const made = await event(host, `Album ${i}`);
      await db
        .insert(schema.eventParticipants)
        .values({ eventId: made.id, actorId: me });
    }

    const items = await activityFor(db, me);
    expect(items).toHaveLength(50);

    // And they are the newest fifty, not the first fifty the query found.
    const times = items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
