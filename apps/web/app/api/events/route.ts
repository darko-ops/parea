/**
 * Create an event — screen 1 of design §3.
 *
 * The creator becomes an actor here, which is the one place identity is minted
 * without an upload: making an event is a contribution of sorts, and the
 * creator needs to be able to administer it afterwards.
 */

import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { ensureActor, grantCapability } from '@/session';

export const runtime = 'nodejs';

type Body = {
  name?: unknown;
  eventDate?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  createdByName?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  const db = getDb();
  const actorId = await ensureActor(
    db,
    typeof body.createdByName === 'string' ? body.createdByName.trim() : undefined,
  );

  const [event] = await db
    .insert(schema.events)
    .values({
      name,
      linkToken: newLinkToken(),
      createdBy: actorId,
      eventDate: asDateString(body.eventDate),
      // Drives auto-selection later (design §7.3). Captured at creation
      // because inferring it from uploads only helps contributor five, not
      // contributor one — who is often the person with 200 photos.
      startsAt: asDate(body.startsAt),
      endsAt: asDate(body.endsAt),
      // Retention lever, populated but not enforced in v1 (design §15).
      expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
    })
    .returning();

  await db
    .insert(schema.eventParticipants)
    .values({ eventId: event!.id, actorId })
    .onConflictDoNothing();

  const code = await claimCode(db, event!.id);
  await grantCapability(event!.id, event!.capEpoch);

  return NextResponse.json(
    {
      id: event!.id,
      name: event!.name,
      linkToken: event!.linkToken,
      url: `/e/${event!.linkToken}`,
      code,
    },
    { status: 201 },
  );
}

/**
 * Take a code from the free pool — design §5.
 *
 * SELECT ... FOR UPDATE SKIP LOCKED so two simultaneous creations take
 * different codes rather than one failing on a unique violation.
 *
 * Returns null when the pool is empty, which is survivable: the link still
 * works and the code is a convenience. Run `deriver jobs seed-codes` to fill
 * it — an empty pool means the spoken-code door never opens.
 */
async function claimCode(
  db: ReturnType<typeof getDb>,
  eventId: string,
): Promise<string | null> {
  const claimed = await db.execute<{ words: string }>(sql`
    update "code" set event_id = ${eventId}, claimed_at = now(), released_at = null
    where id = (
      select id from "code" where event_id is null
      order by random() limit 1 for update skip locked
    )
    returning words
  `);
  return claimed[0]?.words ?? null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
