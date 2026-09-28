/**
 * One moment, and the stream it is in.
 *
 * Read through the same `momentsResponse` Home's strip is built from, so the
 * page can only ever show a moment the strip would have shown this viewer —
 * the audience rule lives in one query, not in a second check here that could
 * disagree with it.
 *
 * `?by=<handle>` is somebody's page: the steps walk only their moments.
 * `?at=` holds the order still while somebody steps through it — see
 * `seenBefore`. Opening a moment is what marks it seen, here on the server
 * where the page is made.
 */

import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { MomentView } from '@/../app/components/MomentView';
import { Shell } from '@/../app/components/Shell';
import { getDb } from '@/db';
import { markSeen, momentsResponse } from '@/moments';
import { currentActorId } from '@/session';
import { ago } from '@/when';
import { readerZone } from '@/zone';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Moment',
  robots: { index: false, follow: false },
};

export default async function MomentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ by?: string; at?: string }>;
}) {
  const { id } = await params;
  const { by, at } = await searchParams;
  const actorId = await currentActorId();
  if (!actorId) notFound();

  let author: string | undefined;
  if (by) {
    const [person] = await getDb()
      .select({ id: schema.actors.id })
      .from(schema.actors)
      .where(eq(sql`lower(${schema.actors.handle})`, by.replace(/^@/, '').toLowerCase()))
      .limit(1);
    if (!person) notFound();
    author = person.id;
  }

  const stamp = at ? new Date(at) : null;
  const seenBefore = stamp && !Number.isNaN(stamp.getTime()) ? stamp : new Date();
  const { moments: all, at: held } = await momentsResponse(actorId, { by: author, seenBefore });

  const index = all.findIndex((m) => m.id === id);
  if (index < 0) notFound();
  const here = all[index]!;
  await markSeen(getDb(), actorId, here.id);

  const zone = await readerZone();
  const exact = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone ?? 'UTC',
  })
    .format(new Date(here.createdAt))
    .replace(' at ', ', ');

  const query = new URLSearchParams({ ...(by ? { by } : {}), at: held }).toString();
  const step = (m: (typeof all)[number] | undefined) => (m ? { id: m.id, src: m.src } : null);

  return (
    <Shell>
      <MomentView
        moment={{
          id: here.id,
          src: here.src,
          mine: here.mine,
          by: here.mine ? 'You' : here.author.name,
          byAvatar: here.author.avatar,
          byHandle: here.author.handle,
          when: exact,
          whenAgo: ago(here.createdAt, new Date()),
        }}
        query={query}
        back={by ? { href: `/u/${encodeURIComponent(by)}`, name: `@${by.replace(/^@/, '')}` } : null}
        position={{ index, total: all.length }}
        previous={step(all[index - 1])}
        next={step(all[index + 1])}
        strip={all.map((m) => ({ id: m.id, src: m.thumb }))}
      />
    </Shell>
  );
}
