/**
 * Create an event — screen 1 of design §3.
 *
 * The creator becomes an actor here, which is the one place identity is minted
 * without an upload: making an event is a contribution of sorts, and the
 * creator needs to be able to administer it afterwards.
 */

import { newLinkToken, schema } from '@parea/core';
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

  await grantCapability(event!.id, event!.capEpoch);

  return NextResponse.json(
    {
      id: event!.id,
      name: event!.name,
      linkToken: event!.linkToken,
      url: `/e/${event!.linkToken}`,
    },
    { status: 201 },
  );
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
