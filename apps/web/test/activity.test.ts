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


/**
 * The lines somebody actually did, which is what every test below is about.
 *
 * `activityFor` ends an empty list with Parea's welcome — a row nobody did,
 * there so that a page with nothing on it has something to be. It is built
 * there rather than in a page because the phone reads this list through
 * `/api/activity` and a welcome drawn by the web's page component is one the
 * phone does not have.
 *
 * Which means "this event produces no line" is now "this event produces no
 * line but the welcome", and saying that forty times is how a test file stops
 * being read. The welcome has its own assertions at the foot of this file.
 */
const did = async (db: Db, actorId: string) =>
  (await activityFor(db, actorId)).filter((item) => item.kind !== 'welcome');

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
      "friend_request", "photo", "photo_tag", "hidden_activity"
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

/** Two events somebody else made, which this actor was let into. */
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

    const before = await did(db, me);
    expect(before).toHaveLength(2);

    await hide(me, before[0]!.id);
    const after = await did(db, me);
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
    const [first] = await did(db, me);

    await hide(me, first!.id);
    expect((await did(db, me)).some((i) => i.id === first!.id)).toBe(false);
  });

  it('is one person’s decision, not everybody’s', async () => {
    // The key names a line, and two people can be shown the same line — being
    // let into the same event, on the same day, by the same host.
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

    const mine = await did(db, me);
    await hide(me, mine[0]!.id);

    expect(await did(db, me)).toHaveLength(0);
    expect(await did(db, you)).toHaveLength(1);
  });

  it('does nothing at all for a key that names no line', async () => {
    // The route cannot check that a key is real — the line has no row — so an
    // arbitrary string has to be harmless rather than rejected.
    const me = await actor('me');
    await twoLines(me);
    await hide(me, 'letin:00000000-0000-0000-0000-000000000000');
    expect(await did(db, me)).toHaveLength(2);
  });

  it('survives being asked twice', async () => {
    // Two tabs, or one impatient tap on a slow connection.
    const me = await actor('me');
    await twoLines(me);
    const [first] = await did(db, me);

    await hide(me, first!.id);
    await db
      .insert(schema.hiddenActivity)
      .values({ actorId: me, itemKey: first!.id })
      .onConflictDoNothing();

    expect(await did(db, me)).toHaveLength(1);
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

    const items = await did(db, me);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'request_answered',
      who: 'You',
      what: 'can see Ultra now',
    });
  });

  it('still says you joined an event nobody had to approve you into', async () => {
    // The link-open case, which is most of them: no request was ever made, so
    // there is nothing else to speak for it.
    const me = await actor('me');
    await twoLines(me);

    const items = await did(db, me);
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

    expect(await did(db, me)).toEqual([]);
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
     * An event fills up after the evening, in bursts. A row per photograph is
     * a page that has to be scrolled past rather than read, and it buries the
     * other kinds of line under whichever event was busiest.
     */
    const me = await actor('me');
    const sarah = await actor('sarah');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const at = new Date();
    for (let i = 0; i < 15; i++) await photo(made.id, sarah, at, i);

    const items = await did(db, me);
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

    const items = await did(db, me);
    expect(items.find((i) => i.kind === 'photos_added')?.what).toBe(
      'added 1 photo to Dinner',
    );
  });

  it('carries three of the photographs it is counting, and no more', async () => {
    /*
     * "Maya added 12 photos to Naxos, September" is a sentence about pictures
     * that shows you none of them, on a page inside a product whose subject is
     * photographs. Three is the number the row has space for; the bound is in
     * SQL rather than in TypeScript because the alternative carries every
     * photograph of a two-hundred-picture burst across the wire to draw three.
     */
    const me = await actor('me');
    const sarah = await actor('sarah');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const at = new Date();
    for (let i = 0; i < 9; i++) await photo(made.id, sarah, at, i);

    const line = (await did(db, me)).find((i) => i.kind === 'photos_added');
    expect(line?.what).toBe('added 9 photos to Dinner');
    expect(line?.images).toHaveLength(3);
    // Addresses, not keys. Every one of these crosses the boundary to a browser.
    expect(line?.images.every((src) => typeof src === 'string' && src.length > 0)).toBe(
      true,
    );
  });

  it('shows what it has when there are fewer than three', async () => {
    const me = await actor('me');
    const sarah = await actor('sarah');
    const made = await event(sarah, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    await photo(made.id, sarah, new Date(), 0);

    const line = (await did(db, me)).find((i) => i.kind === 'photos_added');
    expect(line?.images).toHaveLength(1);
  });

  it('gives every other kind an empty strip rather than none at all', async () => {
    /*
     * `images` is present on every line and empty on all but this one. An
     * optional field would have been the smaller diff and the worse type: a
     * consumer that forgot the `?? []` renders `undefined.map` on whichever
     * kind it had not thought about, which is the kind nobody was testing.
     */
    const me = await actor('me');
    await twoLines(me);

    const items = await did(db, me);
    expect(items).toHaveLength(2);
    expect(items.every((i) => Array.isArray(i.images) && i.images.length === 0)).toBe(
      true,
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

    const lines = (await did(db, me)).filter((i) => i.kind === 'photos_added');
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((l) => l.id)).size).toBe(3);
  });

  it('says nothing about your own photographs, or an event you are not in', async () => {
    const me = await actor('me');
    const stranger = await actor('stranger');
    const mine = await event(me, 'Mine');
    await db.insert(schema.eventParticipants).values({ eventId: mine.id, actorId: me });
    await photo(mine.id, me, new Date(), 0);

    const theirs = await event(stranger, 'Theirs');
    await photo(theirs.id, stranger, new Date(), 1);

    expect((await did(db, me)).filter((i) => i.kind === 'photos_added')).toEqual(
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

    expect((await did(db, me)).filter((i) => i.kind === 'photos_added')).toEqual(
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

    const items = await did(db, me);
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

    expect(await did(db, me)).toEqual([]);
  });

  it('says nothing about one still waiting, or one refused', async () => {
    // Open belongs in the bubble, where it can be answered. A refusal is the
    // refuser's to say, and this page never says it — see `requests.ts`.
    const me = await actor('me');
    const open = await actor('open');
    const no = await actor('no');
    await asks(me, open);
    await asks(me, no, 'declined', new Date());

    expect(await did(db, me)).toEqual([]);
  });
});

describe('somebody arriving in an event you made', () => {
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

    const items = await did(db, me);
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

    expect(await did(db, me)).toEqual([]);
  });

  it('says nothing about your own arrival, or about somebody else’s event', async () => {
    const me = await actor('me');
    const host = await actor('host');
    const mine = await event(me, 'Mine');
    await db.insert(schema.eventParticipants).values({ eventId: mine.id, actorId: me });

    const theirs = await event(host, 'Theirs');
    const stranger = await actor('stranger');
    await db
      .insert(schema.eventParticipants)
      .values({ eventId: theirs.id, actorId: stranger });

    expect(await did(db, me)).toEqual([]);
  });
});

describe('how much of the past is shown', () => {
  it('stops at fifty, newest first', async () => {
    /*
     * A list somebody scans, not an archive they read. Fifty-one events is a
     * contrived number and the test is not: the bound is the only thing
     * standing between this page and a query whose cost grows with how long
     * somebody has used the product.
     */
    const me = await actor('me');
    const host = await actor('host');
    for (let i = 0; i < 55; i++) {
      const made = await event(host, `Event ${i}`);
      await db
        .insert(schema.eventParticipants)
        .values({ eventId: made.id, actorId: me });
    }

    const items = await did(db, me);
    expect(items).toHaveLength(50);

    // And they are the newest fifty, not the first fifty the query found.
    const times = items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

/**
 * The three things that happen to a photograph, and who hears about them.
 *
 * A feed is only worth having if the lines that should be in it are, and the
 * expensive mistake is the quiet one: a notification that never fires looks
 * exactly like a product where nothing happened.
 */
describe('a photograph of yours, and one you are in', () => {
  async function picture(eventId: string, uploaderId: string) {
    const [row] = await db
      .insert(schema.photos)
      .values({
        eventId,
        uploaderId,
        storageKey: `ev/${eventId}/p`,
        byteSize: 1,
        mime: 'image/jpeg',
        status: 'ready',
      })
      .returning();
    return row!;
  }

  const say = (eventId: string, authorActorId: string, body: string, photoId?: string) =>
    db.insert(schema.eventMessages).values({ eventId, authorActorId, body, photoId });

  it('tells you when somebody comments on one you added', async () => {
    const me = await actor('me');
    const them = await actor('them');
    const made = await event(me, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const shot = await picture(made.id, me);

    await say(made.id, them, 'this one is great', shot.id);

    const feed = await did(db, me);
    expect(feed.map((i) => i.kind)).toContain('photo_comment');
    // The remark itself, not the fact that one exists: "commented on your
    // photo" is a line somebody has to open the album to act on, and most of
    // the time what they wanted was to read six words.
    expect(feed.find((i) => i.kind === 'photo_comment')?.what).toMatch(/this one is great/);
  });

  it('does not tell you about your own comment on your own photograph', async () => {
    const me = await actor('me');
    const made = await event(me, 'Dinner');
    const shot = await picture(made.id, me);

    await say(made.id, me, 'mine', shot.id);

    expect(await did(db, me)).toHaveLength(0);
  });

  it('says nothing about a comment on somebody else’s photograph', async () => {
    // The line is about the picture being yours. A comment on a stranger's
    // photograph in an album you are both in is not addressed to you.
    const me = await actor('me');
    const them = await actor('them');
    const made = await event(them, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const theirs = await picture(made.id, them);

    await say(made.id, them, 'look at this', theirs.id);

    expect((await did(db, me)).map((i) => i.kind)).not.toContain('photo_comment');
  });

  it('already told you about your handle in a comment, and still does', async () => {
    /*
     * No new query for this. A comment *is* an `event_message` — one carrying a
     * `photo_id` — so the mention search that has always read that table reads
     * comments too. Worth a case because it is the kind of thing somebody
     * "fixes" by adding a second query that finds the same rows twice.
     */
    const me = await actor('me');
    const them = await actor('them');
    const made = await event(them, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const theirs = await picture(made.id, them);

    await say(made.id, them, 'is that @me in the corner', theirs.id);

    const feed = await did(db, me);
    expect(feed.map((i) => i.kind)).toContain('mention');
    expect(feed.filter((i) => i.kind === 'mention')).toHaveLength(1);
  });

  it('tells you when somebody tags you, and shows the photograph', async () => {
    /*
     * A claim that you are in a picture is one nobody can evaluate without
     * seeing which picture. Making somebody open the album to find out is
     * making them do the work the line was supposed to save.
     */
    const me = await actor('me');
    const them = await actor('them');
    const made = await event(them, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const theirs = await picture(made.id, them);

    await db
      .insert(schema.photoTags)
      .values({ photoId: theirs.id, actorId: me, taggedBy: them });

    const line = (await did(db, me)).find((i) => i.kind === 'tagged');
    expect(line).toBeDefined();
    expect(line!.what).toMatch(/tagged you in a photo in Dinner/);
    expect(line!.images).toHaveLength(1);
  });

  it('says nothing when you tag yourself', async () => {
    const me = await actor('me');
    const made = await event(me, 'Dinner');
    const shot = await picture(made.id, me);

    await db
      .insert(schema.photoTags)
      .values({ photoId: shot.id, actorId: me, taggedBy: me });

    expect((await did(db, me)).map((i) => i.kind)).not.toContain('tagged');
  });

  it('drops both when the photograph is taken down', async () => {
    // A comment on a photograph that is gone is a remark about nothing, and a
    // tag on one is a claim about a picture nobody can look at.
    const me = await actor('me');
    const them = await actor('them');
    const made = await event(me, 'Dinner');
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });
    const shot = await picture(made.id, me);
    await say(made.id, them, 'lovely', shot.id);
    await db
      .insert(schema.photoTags)
      .values({ photoId: shot.id, actorId: me, taggedBy: them });

    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.photos)
      .set({ deletedAt: new Date() })
      .where(eq(schema.photos.id, shot.id));

    const kinds = (await did(db, me)).map((i) => i.kind);
    expect(kinds).not.toContain('photo_comment');
    expect(kinds).not.toContain('tagged');
  });
});

/**
 * A reply, in the only sense a flat comment board has one.
 *
 * `photo_comment` is about the picture being *yours*. Somebody answering your
 * remark under **somebody else's** photograph reached you nowhere at all —
 * which was survivable only while the Chats tab listed every album's comments,
 * and is the reason that list could not simply be deleted.
 */
describe('somebody answering a comment of yours', () => {
  async function photoBy(eventId: string, uploaderId: string) {
    const [row] = await db
      .insert(schema.photos)
      .values({
        eventId,
        uploaderId,
        storageKey: `ev/${eventId}/${Math.random()}`,
        // The columns the table insists on; the helper above passes the same.
        byteSize: 1,
        mime: 'image/jpeg',
        status: 'ready',
      })
      .returning();
    return row!.id;
  }

  const say = (eventId: string, actorId: string, photoId: string, body: string) =>
    db.insert(schema.eventMessages).values({ eventId, authorActorId: actorId, photoId, body });

  it('reaches you when it is under a photograph you commented on', async () => {
    const me = await actor('me');
    const host = await actor('host');
    const made = await event(host);
    const theirs = await photoBy(made.id, host);

    await say(made.id, me, theirs, 'lovely');
    await say(made.id, host, theirs, 'thank you');

    const lines = await did(db, me);
    const reply = lines.find((line) => line.kind === 'comment_reply');
    expect(reply).toBeDefined();
    expect(reply!.what).toContain('thank you');
    expect(reply!.what).toContain('where you commented');
  });

  it('does not reach you where you have said nothing', async () => {
    // Otherwise every remark on every photograph in every album you are in
    // arrives in your tray, which is the noise this is not.
    const me = await actor('me');
    const host = await actor('host');
    const made = await event(host);
    const theirs = await photoBy(made.id, host);
    await db.insert(schema.eventParticipants).values({ eventId: made.id, actorId: me });

    await say(made.id, host, theirs, 'look at this');

    const lines = await did(db, me);
    expect(lines.some((line) => line.kind === 'comment_reply')).toBe(false);
  });

  it('is not your own remark read back at you', async () => {
    const me = await actor('me');
    const host = await actor('host');
    const made = await event(host);
    const theirs = await photoBy(made.id, host);

    await say(made.id, me, theirs, 'first');
    await say(made.id, me, theirs, 'second');

    const lines = await did(db, me);
    expect(lines.some((line) => line.kind === 'comment_reply')).toBe(false);
  });

  it('is one line, not two, on a photograph of your own', async () => {
    /*
     * Both queries match a comment on your own photograph that you had also
     * commented on, and both build a key from the message id — so without the
     * uploader exclusion the feed carries the same remark twice, once as a
     * comment and once as a reply.
     */
    const me = await actor('me');
    const them = await actor('them');
    const made = await event(me);
    const mine = await photoBy(made.id, me);

    await say(made.id, me, mine, 'mine');
    await say(made.id, them, mine, 'nice one');

    const lines = await did(db, me);
    expect(lines.filter((line) => line.what.includes('nice one'))).toHaveLength(1);
    expect(lines.some((line) => line.kind === 'photo_comment')).toBe(true);
    expect(lines.some((line) => line.kind === 'comment_reply')).toBe(false);
  });

  it('forgets a reply whose photograph has been taken down', async () => {
    // A remark about nothing, and the line would lead somewhere empty.
    const { eq } = await import('drizzle-orm');
    const me = await actor('me');
    const host = await actor('host');
    const made = await event(host);
    const theirs = await photoBy(made.id, host);

    await say(made.id, me, theirs, 'lovely');
    await say(made.id, host, theirs, 'thank you');
    await db
      .update(schema.photos)
      .set({ deletedAt: new Date() })
      .where(eq(schema.photos.id, theirs));

    const lines = await did(db, me);
    expect(lines.some((line) => line.kind === 'comment_reply')).toBe(false);
  });
});

/**
 * Parea's welcome, which is the one row in the list nobody did.
 *
 * Tested against a database rather than by reading the source, because every
 * property that makes it honest is a property of what comes back: an account
 * behind the name, a real moment, and a hide that sticks.
 *
 * The Parea actor itself is reference data, seeded by `0037_parea_account.sql`
 * — and `truncate` above clears it between tests, which is why these insert it
 * back rather than assuming it. A missing one is not an error: the row is
 * still built and simply has no picture, the way anybody without an avatar
 * key has none.
 */
describe('the welcome', () => {
  const PAREA = '00000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    await db
      .insert(schema.actors)
      .values({ id: PAREA, kind: 'user', displayName: 'Parea', handle: 'parea' });
  });

  it('is the whole list when there is nothing else', async () => {
    const me = await actor('me');
    const items = await activityFor(db, me);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('welcome');
    expect(items[0]!.who).toBe('Parea');
    // A profile the phone can open: `/u/<handle>` is a shape its Lately maps
    // to a person screen, which is why the row reaches an app already
    // installed without a release.
    expect(items[0]!.href).toBe('/u/parea');
  });

  it('is dated by when you arrived, not by now', async () => {
    /*
     * "Now" would be a timestamp invented for something that never happened.
     * The actor's own `created_at` is the moment Parea had somebody to
     * welcome, and it is the only date this row could honestly carry.
     */
    const { eq } = await import('drizzle-orm');
    const me = await actor('me');
    const [row] = await db
      .select({ createdAt: schema.actors.createdAt })
      .from(schema.actors)
      .where(eq(schema.actors.id, me));
    const [welcome] = await activityFor(db, me);
    expect(welcome!.at).toBe(row!.createdAt.toISOString());
  });

  it('goes when there is something real to say', async () => {
    /*
     * An empty state, not a pinned message. A welcome sitting above a feed is
     * the product still introducing itself to somebody who is using it.
     */
    const me = await actor('me');
    await twoLines(me);
    expect((await activityFor(db, me)).map((i) => i.kind)).not.toContain('welcome');
  });

  it('stays hidden, through the same key every other row uses', async () => {
    // `hidden_activity` takes a free-text key. Every other one names a row
    // that exists; this names a thing that happens once per reader, so the key
    // is a constant — and the filter that takes real rows away takes this one
    // too, rather than a second mechanism beside it.
    const me = await actor('me');
    expect(await activityFor(db, me)).toHaveLength(1);
    await hide(me, 'welcome');
    expect(await activityFor(db, me)).toHaveLength(0);
  });
});
