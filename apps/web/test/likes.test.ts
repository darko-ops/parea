/**
 * Reactions became likes — one heart, and nothing else to choose.
 *
 * Two halves: every reaction route writes `LIKE` whatever it is sent, and
 * migration 0066 folded the reactions already left into likes, one per person
 * per thing.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { LIKE } from '@/reactions';

import { stripComments } from './support/source';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

async function person(handle: string) {
  const [account] = await db.insert(schema.accounts).values({ email: `${handle}@example.test` }).returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle })
    .returning();
  return actor!.id;
}

describe('every reaction route', () => {
  it('stores a like, whatever emoji it is sent', () => {
    for (const kind of ['photos', 'messages', 'group-messages', 'moments']) {
      const route = stripComments(read(`../app/api/${kind}/[id]/reactions/route.ts`));
      expect(route, kind).toMatch(/const emoji = LIKE;/);
      expect(route, kind).not.toMatch(/body\.emoji/);
    }
    expect(LIKE).toBe('❤️');
  });
});

describe('migration 0066', () => {
  it('turns every reaction into one like per person per thing', async () => {
    const [ana, bo, cy] = [await person('ana'), await person('bo'), await person('cy')];
    const [group] = await db.insert(schema.groups).values({ name: 'Tennis', slug: 'tennis' }).returning();
    const [message] = await db
      .insert(schema.groupMessages)
      .values({ groupId: group!.id, authorActorId: ana, body: 'hello' })
      .returning();
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
    await db.insert(schema.groupMessageReactions).values([
      // Three emoji from one person: one like.
      { messageId: message!.id, actorId: ana, emoji: '😂', createdAt: at(1) },
      { messageId: message!.id, actorId: ana, emoji: '🔥', createdAt: at(2) },
      { messageId: message!.id, actorId: ana, emoji: '👏', createdAt: at(3) },
      // A heart beside other emoji: the heart is the one kept.
      { messageId: message!.id, actorId: bo, emoji: '🔥', createdAt: at(1) },
      { messageId: message!.id, actorId: bo, emoji: '❤️', createdAt: at(5) },
      // A single non-heart reaction becomes a like.
      { messageId: message!.id, actorId: cy, emoji: '😮', createdAt: at(4) },
    ]);

    // Statement by statement, as the migrator runs it.
    for (const statement of read('../../../packages/core/drizzle/0066_reactions_to_likes.sql').split('--> statement-breakpoint')) {
      await db.execute(sql.raw(statement));
    }

    const rows = await db
      .select({ actorId: schema.groupMessageReactions.actorId, emoji: schema.groupMessageReactions.emoji, createdAt: schema.groupMessageReactions.createdAt })
      .from(schema.groupMessageReactions);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.emoji === '❤️')).toBe(true);
    // Each person's earliest, or their heart.
    const of = (id: string) => rows.find((row) => row.actorId === id)!.createdAt.getTime();
    expect(of(ana)).toBe(at(1).getTime());
    expect(of(bo)).toBe(at(5).getTime());
    expect(of(cy)).toBe(at(4).getTime());
  });
});
