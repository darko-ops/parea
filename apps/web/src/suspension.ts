/**
 * Whether somebody is suspended — see `suspension` in the schema.
 *
 * Most of the enforcement is not here: `resolveSession` folds the same
 * question into the query that resolves every session, so no route can forget
 * to ask. This is for the places that hold an actor id without a session —
 * a credential from before sessions existed, and the sign-in route, which
 * must refuse before it hands out a credential at all.
 */

import { schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';

import type { Db } from './db';

export async function isSuspended(db: Db, actorId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.suspensions.id })
    .from(schema.suspensions)
    .where(and(eq(schema.suspensions.actorId, actorId), isNull(schema.suspensions.liftedAt)))
    .limit(1);
  return Boolean(row);
}
