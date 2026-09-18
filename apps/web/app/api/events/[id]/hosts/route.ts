/**
 * Who, besides whoever made it, may add photographs to this album.
 *
 * The grant itself, written straight onto the participant row. Everything the
 * *asking* half needs is in `host-requests` next door; this is the one the
 * person who administers the album uses directly — the People tab's "Make a
 * host", and taking it back.
 *
 * ## What a host is not
 *
 * An administrator. `authorize` reads the role for `upload` and for nothing
 * else, so a host adds photographs and cannot rename the album, change who can
 * see it, let anybody in, or hand the role to anybody else. That last one is
 * the important one: promotion is `administer`-only, so the set of people who
 * can add cannot grow without the album's owner, which is the whole reason
 * "Hosts" is safe to offer as a contribute setting at all.
 *
 * ## Why the creator is not a row here
 *
 * Because they are the creator, and `authorize` reads `createdBy` directly.
 * Writing `role = 'host'` onto their participant row as well would be a second
 * place the same fact is stored, and the day the two disagree the wrong one
 * wins silently. Demoting is refused for the same reason rather than allowed
 * and quietly ineffective.
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById } from '@/access';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/**
 * Making somebody a host, or taking it back.
 *
 * One verb with a boolean rather than POST-to-promote and DELETE-to-demote:
 * the two are the same write to the same column, and the manage screen's
 * control is a toggle.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    actorId?: unknown;
    host?: unknown;
  };
  if (typeof body.actorId !== 'string' || typeof body.host !== 'boolean') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return notFound();

  const actorId = await currentActorId();
  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow || !actorId) return notFound();

  /*
   * The creator is a host by being the creator, and cannot stop being one.
   *
   * Said as its own refusal rather than by letting the write succeed against a
   * column nothing reads for them: a manage screen that appears to demote the
   * owner and does not is worse than one that says it will not.
   */
  if (body.actorId === event.createdBy) {
    return NextResponse.json({ error: 'creator_is_host' }, { status: 409 });
  }

  /*
   * Only somebody already in the album.
   *
   * Being a host is a property of being in it — the role lives on the
   * participant row precisely so there is no state where somebody is a host of
   * an album they are not in, and leaving takes both together. An `update`
   * that matches no row does nothing quietly, so the miss is reported.
   */
  const updated = await db
    .update(schema.eventParticipants)
    .set({ role: body.host ? 'host' : 'member' })
    .where(
      and(
        eq(schema.eventParticipants.eventId, id),
        eq(schema.eventParticipants.actorId, body.actorId),
      ),
    )
    .returning({ actorId: schema.eventParticipants.actorId });

  if (updated.length === 0) return notFound();

  /*
   * And their open request, answered by the thing it was asking for.
   *
   * Somebody can be promoted from the People tab while their own ask is still
   * sitting in the queue — the host went looking rather than waiting. Leaving
   * it open would show a question about a person who already has the answer,
   * and the host would resolve it a second time.
   *
   * Demoting does not reopen anything: a request is a record of having asked,
   * not of the current state, and reviving it would put a question the host
   * has just answered back in front of them.
   */
  if (body.host) {
    await db
      .update(schema.eventHostRequests)
      .set({ status: 'approved', resolvedAt: new Date(), resolvedBy: actorId })
      .where(
        and(
          eq(schema.eventHostRequests.eventId, id),
          eq(schema.eventHostRequests.actorId, body.actorId),
          eq(schema.eventHostRequests.status, 'open'),
        ),
      );
  }

  return NextResponse.json({ ok: true, host: body.host });
}
