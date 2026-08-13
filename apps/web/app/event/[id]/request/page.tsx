/**
 * The door of a private event, from outside it.
 *
 * Reached from `/e/<token>` when the host has not let this person in yet. It
 * exists because the alternative was a 404, and a 404 to somebody holding a
 * link you sent them is a lie that reads as a broken product.
 *
 * What it may show is bounded by what they have proved. A fresh capability
 * cookie means this browser exchanged the real link, so the event's name is
 * not news to them and naming it is what makes the page make sense. Everything
 * else — the photographs, who is in it, how many — stays behind the approval,
 * which is the entire point of the policy.
 */

import { REQUEST_ACCESS, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { AskToJoin } from '@/../app/components/AskToJoin';
import { Shell } from '@/../app/components/Shell';
import { findEventById, isSignedIn } from '@/access';
import { getDb } from '@/db';
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
  if (!event || event.deletedAt || event.accessPolicy !== REQUEST_ACCESS) notFound();

  const requester = await requesterFor(id);
  // Same answer as a nonexistent event for anyone who did not arrive through
  // the link, so this page cannot be used to test whether an id is real.
  if (requester.capEpoch !== event.capEpoch) notFound();

  const actorId = requester.actorId;
  const signedIn = await isSignedIn(db, actorId);

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
