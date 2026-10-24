/**
 * The hourly purge ends signed-in sessions past their time — `expireSessions`.
 *
 * The web app revokes an expired session when it is next presented. A phone
 * in a drawer never presents it, so without this it would go on receiving
 * notifications for as long as the row lived. These pin that the sweep revokes
 * it and drops its push rows, and leaves guests and live sessions alone.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema, SESSION_IDLE_DAYS } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expireSessions } from '../src/jobs';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "session", "device" restart identity cascade`);
});

async function person(withAccount: boolean) {
  const accountId = withAccount
    ? (await db.insert(schema.accounts).values({ email: `${crypto.randomUUID()}@example.test` }).returning())[0].id
    : null;
  const [actor] = await db.insert(schema.actors).values({ kind: withAccount ? 'user' : 'guest', accountId }).returning();
  return actor.id as string;
}

async function phone(actorId: string, lastSeenDaysAgo: number) {
  const at = new Date(Date.now() - lastSeenDaysAgo * DAY);
  const [session] = await db
    .insert(schema.sessions)
    .values({ actorId, kind: 'ios', method: 'code', lastSeenAt: at, signedInAt: at, createdAt: at })
    .returning();
  await db.insert(schema.devices).values({ actorId, platform: 'ios', pushToken: `push-${session.id}`, sessionId: session.id });
  return session.id as string;
}

const revoked = async (id: string) =>
  (await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)))[0].revokedAt !== null;

describe('ending sessions past their time', () => {
  it('revokes an idle signed-in session and stops its notifications', async () => {
    const me = await person(true);
    const idle = await phone(me, SESSION_IDLE_DAYS + 1);
    const live = await phone(me, 1);

    await expireSessions(db);

    expect(await revoked(idle)).toBe(true);
    expect(await revoked(live)).toBe(false);
    const left = await db.select({ sessionId: schema.devices.sessionId }).from(schema.devices);
    expect(left).toEqual([{ sessionId: live }]);
  });

  it('leaves a guest alone, however long it has been', async () => {
    const guest = await person(false);
    const old = await phone(guest, SESSION_IDLE_DAYS * 3);
    await expireSessions(db);
    expect(await revoked(old)).toBe(false);
  });
});
