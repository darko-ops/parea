/**
 * The door of a private album, from outside it.
 *
 * Two ways here and they are the two halves of what private means. From
 * `/e/<token>`, when the link has been sent to somebody who is not in yet — it
 * exists because the alternative was a 404, and a 404 to somebody holding a
 * link you sent them is a lie that reads as a broken product. And from the
 * creator's profile, where private albums are listed by name to anybody signed
 * in, with this as the only thing under them to press.
 *
 * So it shows the name to whoever proved either: a fresh capability cookie
 * means this browser exchanged the real link, and being signed in means they
 * could have read the same name off the profile a second ago. Somebody with
 * neither gets the answer a nonexistent album gets. Everything past the
 * name — the photographs, who is in it, how many — stays behind the approval,
 * which is the entire point of the policy.
 */

import { PRIVATE, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { AskToJoin } from '@/../app/components/AskToJoin';
import { Shell } from '@/../app/components/Shell';
import { findEventById, isSignedIn } from '@/access';
import { getDb } from '@/db';
import { isBlockedBy } from '@/moderation';
import { requesterFor } from '@/session';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event || event.deletedAt || event.accessPolicy !== PRIVATE) notFound();

  const requester = await requesterFor(id);
  const actorId = requester.actorId;
  const signedIn = await isSignedIn(db, actorId);
  // The link, or an account. A signed-out browser that never exchanged the
  // link gets the answer a nonexistent album gets, so a bare id cannot be
  // tested from outside.
  const viaLink = requester.capEpoch === event.capEpoch;
  if (!signedIn && !viaLink) notFound();

  // A block is silent, and this page must not be the thing that breaks that:
  // somebody the creator has blocked cannot see the profile listing this album
  // and gets the same answer here.
  if (actorId && (await isBlockedBy(db, event.createdBy, actorId))) notFound();

  // Already in — approved between the redirect and this render, or arriving
  // here by hand. Nothing to ask for.
  if (actorId) {
    const [participant] = await db
      .select({ actorId: schema.eventParticipants.actorId })
      .from(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, id),
          eq(schema.eventParticipants.actorId, actorId),
        ),
      )
      .limit(1);
    if (participant) redirect(`/event/${id}`);
  }

  const [existing] = actorId
    ? await db
        .select({ status: schema.eventAccessRequests.status })
        .from(schema.eventAccessRequests)
        .where(
          and(
            eq(schema.eventAccessRequests.eventId, id),
            eq(schema.eventAccessRequests.actorId, actorId),
          ),
        )
        .limit(1)
    : [];

  return (
    <Shell>
      <main className="wrap">
        <AskToJoin
          eventId={id}
          eventName={event.name}
          signedIn={signedIn}
          initialStatus={existing?.status ?? null}
        />
      </main>
    </Shell>
  );
}
