/**
 * A phone number the product does not keep.
 *
 * The feature is "somebody who already has your number can find you", and
 * nothing in it needs the digits — it needs to know two people typed the same
 * number. So the column is a keyed hash, and these are the properties that
 * make that worth doing rather than theatre.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { findByPhone, looksLikePhone } from '@/friends';
import { hashPhone, lastTwo, normalisePhone } from '@/phone';

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
  await db.execute(sql`truncate "account", "actor", "block" restart identity cascade`);
});

async function person(handle: string, phone?: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.invalid` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({
      kind: 'user',
      handle,
      accountId: account!.id,
      ...(phone
        ? { phoneHash: hashPhone(normalisePhone(phone)!), phoneLast2: lastTwo(phone) }
        : {}),
    })
    .returning();
  return actor!.id;
}

describe('what counts as a number', () => {
  it('needs the country code, and says so by refusing', () => {
    /*
     * A hash matches another hash of the *identical* string, so "07700 900123"
     * and "+44 7700 900123" are one number and two hashes. The product cannot
     * know which country a bare local number belongs to, so it asks rather
     * than guessing — a wrong guess is a lookup that silently finds nobody,
     * which reads as "they are not on here".
     */
    expect(normalisePhone('07700 900123')).toBeNull();
    expect(normalisePhone('555-0142')).toBeNull();
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('survives the punctuation people actually type', () => {
    expect(normalisePhone('+1 (555) 010-4477')).toBe('+15550104477');
    expect(normalisePhone('+1.555.010.4477')).toBe('+15550104477');
  });

  it('refuses things that are not numbers at all', () => {
    for (const input of ['', '+', '+0123456789', '+12', 'not a phone', '+12345abc678']) {
      expect(normalisePhone(input), input).toBeNull();
    }
  });
});

describe('what is stored', () => {
  it('is not the number', () => {
    // The point of the whole exercise: a copy of this table is not a phone
    // book. Asserted on the hash itself rather than on the column, because a
    // hash that happened to contain the digits would pass a column check.
    const hash = hashPhone('+15550104477');
    expect(hash).not.toContain('5550104477');
    expect(hash).not.toContain('+1');
  });

  it('is the same for the same number and different for another', () => {
    expect(hashPhone('+15550104477')).toBe(hashPhone('+15550104477'));
    expect(hashPhone('+15550104477')).not.toBe(hashPhone('+15550104478'));
  });

  it('keeps two digits so a profile can say which number it is', () => {
    // Two identify nobody, and "a number is set" is not enough to answer "is
    // it my old one?".
    expect(lastTwo('+15550104477')).toBe('77');
  });
});

describe('finding somebody by a number you already have', () => {
  it('matches the whole number, and only exactly', async () => {
    const me = await person('me');
    await person('them', '+15550104477');

    expect((await findByPhone(db, me, '+1 555 010 4477')).map((p) => p.handle)).toEqual([
      'them',
    ]);
    // A prefix would be a way to walk the account table ten digits at a time.
    expect(await findByPhone(db, me, '+1555010447')).toEqual([]);
  });

  it('never returns you to yourself', async () => {
    const me = await person('me', '+15550104477');
    expect(await findByPhone(db, me, '+15550104477')).toEqual([]);
  });

  it('respects a block in either direction', async () => {
    // The same rule the handle search follows. A block hides two people from
    // each other everywhere, and a number is not an exception to it.
    const me = await person('me');
    const them = await person('them', '+15550104477');
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: them, blockedActorId: me });

    expect(await findByPhone(db, me, '+15550104477')).toEqual([]);
  });

  it('finds nobody once a number is removed', async () => {
    const me = await person('me');
    const them = await person('them', '+15550104477');
    await db
      .update(schema.actors)
      .set({ phoneHash: null, phoneLast2: null })
      .where(eq(schema.actors.id, them));

    expect(await findByPhone(db, me, '+15550104477')).toEqual([]);
  });
});

describe('the search box knows a number from a name', () => {
  it('treats a leading + and digits as a lookup', () => {
    expect(looksLikePhone('+15550104477')).toBe(true);
    expect(looksLikePhone('+1 (555) 010-4477')).toBe(true);
  });

  it('treats everything else as a handle search', () => {
    for (const input of ['nadia', '+', 'roast anchor', '5550104477']) {
      expect(looksLikePhone(input), input).toBe(false);
    }
  });
});

describe('the profile never sends the number back', () => {
  it('returns two digits and no column that could hold one', () => {
    // There is nothing to prefill the box with, and that is the honest picture
    // of what is stored rather than an omission.
    const accounts = readFileSync(
      fileURLToPath(new URL('../src/accounts.ts', import.meta.url)),
      'utf8',
    );
    expect(accounts).toMatch(/phoneLast2: schema\.actors\.phoneLast2/);
    expect(accounts).not.toMatch(/phoneHash: schema\.actors\.phoneHash/);
  });
});
