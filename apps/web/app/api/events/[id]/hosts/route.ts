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
 *
 * ## Two kinds of co-host, one toggle
 *
 * Somebody named a co-host while the album was being made has no participant
 * row — an invitation grants nothing until it is accepted — so the promise sits
 * on `event_invite.as_host` and is spent on arrival. That means the set of
 * co-hosts an owner is looking at has two kinds of row in it, and this route
 * writes to whichever one the person has: the participant row where they are
 * here, the open invitation where they are not.
 *
 * One endpoint rather than two, because it is one control. "Take Sam back out"
 * is the same sentence whether or not Sam has opened the link yet, and an owner
 * who had to know which would be doing the server's bookkeeping.
 *
 * Adding a co-host who is not in the album at all is the other route:
 * `POST /invites` with `hostActorIds`, since that act is also asking them in.
 */

import { schema } from '@parea/core';
import { and, asc, eq, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/**
 * A bound on the list, high rather than tight.
 *
 * The set of people holding the camera at one evening is small, and this exists
 * so that an album whose invitations went somewhere strange cannot turn one
 * screen into a thousand presigned URLs. The same reasoning as `MEMBER_LIMIT`.
 */
const MAX_HOSTS = 200;

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

  /*
   * Nobody in the album by that name — so try the invitation, which is where a
   * co-host named before they arrived is recorded.
   *
   * `open` only, and for the same reason the invites route restricts its own
   * write to it: a declined invitation is an answer, and an accepted one
   * belongs to the participant row above. What is left is a promise nobody has
   * answered yet, which is exactly the thing an owner is taking back.
   *
   * A miss here as well is a 404. It was already one; this only moves where the
   * last look happens.
   */
  if (updated.length === 0) {
    const promised = await db
      .update(schema.eventInvites)
      .set({ asHost: body.host })
      .where(
        and(
          eq(schema.eventInvites.eventId, id),
          eq(schema.eventInvites.actorId, body.actorId),
          eq(schema.eventInvites.status, 'open'),
        ),
      )
      .returning({ id: schema.eventInvites.id });

    if (promised.length === 0) return notFound();
    /*
     * And no host request to close.
     *
     * Asking to be a co-host is something people already inside do — the route
     * next door requires `contribute` — so somebody with an open invitation and
     * no participant row cannot have one waiting. Falling through to the update
     * below would be a statement that matches nothing, every time.
     */
    return NextResponse.json({ ok: true, host: body.host, pending: true });
  }

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

/**
 * The album's co-hosts, for the screen that manages them.
 *
 * Both kinds in one list — the people who are here with `role = 'host'`, and
 * the people who were named and have not answered — because that is what the
 * owner of the album is looking at. Which of the two a row is comes back as
 * `pending`, since the only thing it changes is the word beside the name.
 *
 * Not the creator. They are a host by being the creator and cannot stop being
 * one, so a row for them in a list whose every entry has a "Remove" beside it
 * is a control that does nothing — see the refusal in `POST`.
 *
 * `administer` rather than `view`: the People tab already shows everybody in the
 * album who may add, to everybody in it, and that is the right disclosure for a
 * room. This is the editable list, and an open invitation is not something the
 * rest of the album is told about.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const event = await findEventById(db, id);
  if (!event) return notFound();

  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow) return notFound();

  /*
   * Two reads, side by side. They have nothing to say to each other — a person
   * cannot hold a participant row and an open invitation to the same album at
   * once, since accepting is what writes the row — so running them in series
   * would be a round trip spent on nothing.
   */
  const [here, promised] = await Promise.all([
    db
      .select({
        actorId: schema.actors.id,
        displayName: schema.actors.displayName,
        handle: schema.actors.handle,
        avatarKey: schema.actors.avatarKey,
      })
      .from(schema.eventParticipants)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.eventParticipants.actorId))
      .where(
        and(
          eq(schema.eventParticipants.eventId, id),
          eq(schema.eventParticipants.role, 'host'),
          ne(schema.eventParticipants.actorId, event.createdBy),
        ),
      )
      .orderBy(asc(schema.eventParticipants.firstSeenAt))
      .limit(MAX_HOSTS),
    db
      .select({
        actorId: schema.actors.id,
        displayName: schema.actors.displayName,
        handle: schema.actors.handle,
        avatarKey: schema.actors.avatarKey,
      })
      .from(schema.eventInvites)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.eventInvites.actorId))
      .where(
        and(
          eq(schema.eventInvites.eventId, id),
          eq(schema.eventInvites.status, 'open'),
          eq(schema.eventInvites.asHost, true),
        ),
      )
      .orderBy(asc(schema.eventInvites.createdAt))
      .limit(MAX_HOSTS),
  ]);

  const named = async (
    row: { actorId: string; displayName: string | null; handle: string | null; avatarKey: string | null },
    pending: boolean,
  ) => ({
    actorId: row.actorId,
    name: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
    handle: row.handle,
    // Presigned here, one HMAC per row. The key never crosses the boundary.
    avatar: await avatarUrl(row.avatarKey),
    pending,
  });

  return NextResponse.json({
    hosts: [
      ...(await Promise.all(here.map((row) => named(row, false)))),
      ...(await Promise.all(promised.map((row) => named(row, true)))),
    ],
  });
}
