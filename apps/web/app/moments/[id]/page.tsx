/**
 * One moment, and the row it is in.
 *
 * Read through the same `momentsResponse` Home's row is built from, so the
 * page can only ever show a moment the row would have shown this viewer — the
 * audience rule lives in one query, not in a second check here that could
 * disagree with it.
 */

import { notFound } from 'next/navigation';

import { MomentView } from '@/../app/components/MomentView';
import { Shell } from '@/../app/components/Shell';
import { momentsResponse } from '@/moments';
import { currentActorId } from '@/session';
import { ago } from '@/when';
import { readerZone } from '@/zone';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Moment',
  robots: { index: false, follow: false },
};

export default async function MomentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) notFound();

  const { people } = await momentsResponse(actorId);
  const all = people.flatMap((person) =>
    person.moments.map((moment) => ({ ...moment, person })),
  );
  const index = all.findIndex((m) => m.id === id);
  if (index < 0) notFound();
  const here = all[index]!;

  const zone = await readerZone();
  const at = new Date(here.createdAt);
  const exact = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone ?? 'UTC',
  })
    .format(at)
    .replace(' at ', ', ');

  const step = (m: (typeof all)[number] | undefined) => (m ? { id: m.id, src: m.src } : null);

  return (
    <Shell>
      <MomentView
        moment={{
          id: here.id,
          src: here.src,
          mine: here.person.mine,
          by: here.person.mine ? 'You' : here.person.name,
          byAvatar: here.person.avatar,
          byHandle: here.person.handle,
          when: exact,
          whenAgo: ago(here.createdAt, new Date()),
        }}
        position={{ index, total: all.length }}
        previous={step(all[index - 1])}
        next={step(all[index + 1])}
        strip={all.map((m) => ({ id: m.id, src: m.src }))}
      />
    </Shell>
  );
}
