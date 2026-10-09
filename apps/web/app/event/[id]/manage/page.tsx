import { schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { ManageView } from '@/../app/components/ManageView';
import { decide, findEventById } from '@/access';
import { coverSrc } from '@/cards';
import { getDb } from '@/db';
import { findGroup, rollGroupSummary } from '@/groups';
import { requesterFor } from '@/session';
import { Shell } from '@/../app/components/Shell';

export const dynamic = 'force-dynamic';

/**
 * Belt and braces with the `X-Robots-Tag` header in `next.config.ts`. The
 * header is the one that covers non-HTML responses and survives a crawler
 * finding the URL elsewhere; this one survives the headers not being applied,
 * which is a deployment property rather than a code one.
 */
export const metadata = { robots: { index: false, follow: false } };


/**
 * Host controls. Guarded with `administer`, and a denial renders as not-found
 * rather than forbidden so the page cannot be used to discover which event ids
 * are real.
 */
export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; from?: string }>;
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

  // The group's header: drawn on the first paint, so resolved here.
  const group = event.groupId ? await findGroup(db, event.groupId) : null;
  const groupSummary = group ? await rollGroupSummary(db, group, requester.actorId) : null;

  return (
    <Shell>
      <ManageView
        eventId={event.id}
        // Anything that is not the one alternative is the default rather than
        // an error: `?tab=` is a thing people edit, and a 400 for a typo in a
        // tab name helps nobody.
        tab={(await searchParams).tab === 'members' ? 'members' : 'manage'}
        // Opened from your profile: the way back, and where deleting it lands.
        fromProfile={(await searchParams).from === 'profile'}
        initial={{
          name: event.name,
          caption: event.caption,
          joinsOpen: event.joinsOpen,
          contributePolicy: event.contributePolicy,
          accessPolicy: event.accessPolicy,
          code: code?.words ?? null,
          url: `/e/${event.linkToken}`,
          groupId: event.groupId,
          groupName: group?.name ?? null,
          group: groupSummary,
          // Taking it out of its group is the creator's alone — see the route.
          isCreator: requester.actorId === event.createdBy,
          // Presigned, an hour, like every other cover URL. The key stays on
          // this side of the boundary — see `coverSrc`.
          coverUrl: await coverSrc(event.coverKey),
        }}
      />
    </Shell>
  );
}
