/**
 * Reacting to a group's message, through the handler rather than around it.
 *
 * The module below it is tested in `group-messages.test.ts`; what only a
 * handler can answer is who is allowed to call it. Three refusals matter and
 * all three are silent failures if they go wrong: somebody who was in the
 * group yesterday, somebody who is not signed in, and somebody sending
 * something that is not an emoji through a box labelled "pick an emoji".
 *
 * The fourth is the ceiling, which was unreachable while the offered six were
 * also the validation and is a real limit now that a picker can produce
 * anything a phone can.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { postGroupMessage, groupMessagesFor } = await import('@/groupMessages');
const { addMember } = await import('@/groups');
const { MAX_PER_MESSAGE } = await import('@/reactions');
const { POST } = await import('../app/api/group-messages/[id]/reactions/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "groups", "group_member", "group_message",
             "group_message_reaction"
    restart identity cascade
  `);
  headerBag.clear();
});

/**
 * An actor that has claimed an account, which is what this route requires.
 *
 * Signing in is the only thing that sets `accountId`, so the fixture sets it
 * directly rather than driving the whole code exchange — the same shortcut
 * `access.test.ts` takes for the same reason.
 */
async function person(displayName: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName, accountId: account!.id })
    .returning();
  return actor!.id;
}

let slug = 0;
async function group(name = 'Fam Jam') {
  const [row] = await db
    .insert(schema.groups)
    .values({ name, slug: `g${++slug}` })
    .returning();
  return row!.id;
}

/** The app's way in: a signed actor id as a bearer token. */
function as(actorId: string | null) {
  headerBag.clear();
  if (actorId) headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

const react = (messageId: string, emoji: unknown) =>
  POST(
    new Request('https://parea.test/api/group-messages/x/reactions', {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
    { params: Promise.resolve({ id: messageId }) },
  );

describe('who may react in a group', () => {
  it('lets a member on and off again', async () => {
    const me = await person('Demetri');
    const room = await group();
    await addMember(db, room, me);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(me);
    const on = await react(said, '❤️');
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ state: 'added' });

    const off = await react(said, '❤️');
    expect(await off.json()).toEqual({ state: 'removed' });

    const [message] = await groupMessagesFor(db, room, me);
    expect(message!.reactions).toEqual([]);
  });

  it('refuses somebody who is not in the group, as a 404', async () => {
    /*
     * Not a 403. A refusal that distinguishes "you may not" from "there is no
     * such message" is a way to ask whether a message id is real, and a group
     * is the one room in the product whose whole existence is private.
     */
    const me = await person('Demetri');
    const them = await person('Ana');
    const room = await group();
    await addMember(db, room, me);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(them);
    expect((await react(said, '❤️')).status).toBe(404);

    /*
     * And somebody who *was* in it. Leaving takes the room with it — the
     * membership row is deleted rather than flagged, which is why this is a
     * delete rather than a call: there is no `removeMember` to reach for.
     */
    const { and, eq } = await import('drizzle-orm');
    await addMember(db, room, them);
    await db
      .delete(schema.groupMembers)
      .where(
        and(eq(schema.groupMembers.groupId, room), eq(schema.groupMembers.actorId, them)),
      );
    as(them);
    expect((await react(said, '❤️')).status).toBe(404);
  });

  it('refuses a message that does not exist, the same way', async () => {
    const me = await person('Demetri');
    as(me);
    const missing = await react('00000000-0000-4000-8000-000000000000', '❤️');
    expect(missing.status).toBe(404);
  });

  it('asks for an account', async () => {
    // A reaction is attributed and counted and shown to everybody in the
    // room, which is the same standard as posting.
    const me = await person('Demetri');
    const room = await group();
    await addMember(db, room, me);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(null);
    expect((await react(said, '❤️')).status).toBe(401);
  });
});

describe('what may be sent', () => {
  it('takes any emoji, not one of six', async () => {
    const me = await person('Demetri');
    const room = await group();
    await addMember(db, room, me);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(me);
    for (const emoji of ['🦑', '🇬🇷', '1️⃣']) {
      expect((await react(said, emoji)).status, emoji).toBe(200);
    }
  });

  it('refuses anything that is not one emoji', async () => {
    /*
     * The rule doing the work is that it is a single grapheme. Without it a
     * row of pills under a message is an unmoderated text channel reached
     * through a box labelled "pick an emoji".
     */
    const me = await person('Demetri');
    const room = await group();
    await addMember(db, room, me);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(me);
    for (const bad of ['not an emoji, a sentence', '❤️🔥', '', 'a', 42, null]) {
      const refused = await react(said, bad);
      expect(refused.status, String(bad)).toBe(400);
      expect(await refused.json()).toEqual({ error: 'not_an_emoji' });
    }
  });

  it('stops one person at six, and still lets them take one back', async () => {
    /*
     * The bound that stops one account turning somebody's sentence into a
     * wall of pills. Checked before adding and never before removing:
     * somebody at the limit who could not undo one would be stuck with six.
     */
    const me = await person('Demetri');
    const room = await group();
    await addMember(db, room, me);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(me);
    const six = ['❤️', '😂', '🔥', '👏', '😮', '🙏'];
    expect(six).toHaveLength(MAX_PER_MESSAGE);
    for (const emoji of six) expect((await react(said, emoji)).status).toBe(200);

    const seventh = await react(said, '🦑');
    expect(seventh.status).toBe(409);
    expect(await seventh.json()).toEqual({ error: 'too_many', max: MAX_PER_MESSAGE });

    // The seventh was not kept, and the six are still six.
    const [message] = await groupMessagesFor(db, room, me);
    expect(message!.reactions.map((r) => r.emoji).sort()).toEqual([...six].sort());

    // And one of the six comes off, from the same state that refused a new one.
    expect(await (await react(said, '❤️')).json()).toEqual({ state: 'removed' });
  });

  it('counts each person’s own six, not the message’s', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    const room = await group();
    await addMember(db, room, me);
    await addMember(db, room, them);
    const said = await postGroupMessage(db, room, me, 'Sunday?');

    as(me);
    for (const emoji of ['❤️', '😂', '🔥', '👏', '😮', '🙏']) await react(said, emoji);
    // Somebody else is nowhere near the limit, whatever the message carries.
    as(them);
    expect((await react(said, '🦑')).status).toBe(200);
  });
});
