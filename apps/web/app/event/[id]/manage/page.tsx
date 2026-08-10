import { schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { ManageView } from '@/../app/components/ManageView';
import { decide, findEventById } from '@/access';
import { getDb } from '@/db';
import { requesterFor } from '@/session';

export const dynamic = 'force-dynamic';

/**
 * Host controls. Guarded with `administer`, and a denial renders as not-found
 * rather than forbidden so the page cannot be used to discover which event ids
 * are real.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) notFound();

  const requester = await requesterFor(id);
  if (!(await decide(db, event, 'administer', requester)).allow) notFound();

  const [code] = await db
    .select({ words: schema.codes.words })
    .from(schema.codes)
    .where(and(eq(schema.codes.eventId, event.id), isNull(schema.codes.releasedAt)))
    .limit(1);

  return (
    <ManageView
      eventId={event.id}
      initial={{
        name: event.name,
        joinsOpen: event.joinsOpen,
        uploadsOpen: event.uploadsOpen,
        code: code?.words ?? null,
        url: `/e/${event.linkToken}`,
        groupId: event.groupId,
      }}
    />
  );
}
