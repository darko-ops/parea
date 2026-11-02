/**
 * "Hide from profile" — a roll kept on somebody's home screen and off their
 * profile, from the roll's own sheet.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { eventsFor, setHiddenFromProfile } from '@/events';
import { eventsWithBoth } from '@/people';

import { stripComments } from './support/source';

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
    truncate "account", "actor", "event", "groups", "group_member", "profile_hidden_event"
    restart identity cascade
  `);
});

async function person(handle: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle })
    .returning();
  return actor!.id;
}

/** A roll in a group, made by its admin, with everybody in the group. */
async function groupRoll(admin: string, ...members: string[]) {
  const [group] = await db
    .insert(schema.groups)
    .values({ name: 'Crew', slug: `crew-${Math.random().toString(36).slice(2)}` })
    .returning();
  await db
    .insert(schema.groupMembers)
    .values([admin, ...members].map((actorId) => ({ groupId: group!.id, actorId })));
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: admin, groupId: group!.id })
    .returning();
  await db
    .insert(schema.eventParticipants)
    .values([admin, ...members].map((actorId) => ({ eventId: event!.id, actorId })));
  return event!.id;
}

describe('hiding a roll from your profile', () => {
  it('keeps it on home, marks it off the profile, and takes it back', async () => {
    const admin = await person('admin');
    const me = await person('me');
    const party = await groupRoll(admin, me);

    expect(await setHiddenFromProfile(db, party, me, true)).toBe(true);
    // Twice is still hidden, not an error.
    expect(await setHiddenFromProfile(db, party, me, true)).toBe(true);
    const [card] = await eventsFor(db, me);
    expect(card).toMatchObject({ id: party, hiddenFromProfile: true, homeOnly: true });

    await setHiddenFromProfile(db, party, me, false);
    expect((await eventsFor(db, me))[0]).toMatchObject({ hiddenFromProfile: false, homeOnly: false });
  });

  it('is yours alone', async () => {
    const admin = await person('admin');
    const me = await person('me');
    const party = await groupRoll(admin, me);
    await setHiddenFromProfile(db, party, me, true);
    expect((await eventsFor(db, admin))[0]).toMatchObject({ hiddenFromProfile: false, homeOnly: false });
  });

  it('takes it off the rolls in common somebody sees on your profile', async () => {
    const admin = await person('admin');
    const me = await person('me');
    const party = await groupRoll(admin, me);
    expect((await eventsWithBoth(db, admin, me)).map((e) => e.id)).toEqual([party]);
    await setHiddenFromProfile(db, party, me, true);
    expect(await eventsWithBoth(db, admin, me)).toEqual([]);
  });

  it('answers false for a roll that does not exist', async () => {
    const me = await person('me');
    expect(
      await setHiddenFromProfile(db, '00000000-0000-4000-8000-0000000000ff', me, true),
    ).toBe(false);
  });

  it('is in the sheet, under the three, for somebody in a group roll they do not run', () => {
    const app = stripComments(
      readFileSync(new URL('../../mobile/App.tsx', import.meta.url), 'utf8'),
    );
    expect(app).toMatch(/\{known && !host && feed\?\.event\.groupId && \(\s*<Row/);
    expect(app).toMatch(/hiddenFromProfile \? 'Show on profile' : 'Hide from profile'/);
  });
});
