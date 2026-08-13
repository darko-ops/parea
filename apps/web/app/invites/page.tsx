/**
 * Invites — other people's events, in the two states they can be in.
 *
 * The tabs are links and the page is server-rendered, so which one you are on
 * survives a reload and can be sent to somebody. A pair of buttons swapping
 * client state would look identical and lose both.
 *
 * Not indexable: it lists what one person is in and what they have asked for.
 */

import { EventCard } from '@/../app/components/EventCard';
import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { askedToJoin, invitedEvents } from '@/invites';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Invites',
  robots: { index: false, follow: false },
};

const AGO = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Rough on purpose: nobody needs "3 hours and 12 minutes ago" for this. */
function ago(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 3600
      ? ['minute', 60]
      : Math.abs(seconds) < 86_400
        ? ['hour', 3600]
        : ['day', 86_400];
  return AGO.format(Math.round(seconds / size), unit);
}

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const waiting = tab === 'asked';

  const db = getDb();
  const actorId = await currentActorId();
  const [invited, asked] = await Promise.all([
    invitedEvents(db, actorId),
    askedToJoin(db, actorId),
  ]);
  const cards = await toCards(invited);
  const now = new Date();

  return (
    <Shell current="invites">
      <main className="main">
        <div className="main-head">
          <h1>Invites</h1>
        </div>

        {/*
          Counted on the tab itself. The number is the only reason to look at
          the other one, and a person who has been let in since they last
          checked should not have to open both to find out.
        */}
        <nav className="tabs" aria-label="Which invites">
          <a href="/invites" aria-current={waiting ? undefined : 'page'}>
            Invited{invited.length > 0 && ` (${invited.length})`}
          </a>
          <a href="/invites?tab=asked" aria-current={waiting ? 'page' : undefined}>
            Asked to join{asked.length > 0 && ` (${asked.length})`}
          </a>
        </nav>

        {!waiting &&
          (cards.length === 0 ? (
            <p className="empty muted">
              Nothing yet. An event somebody else made shows up here once you
              open the link they sent you.
            </p>
          ) : (
            <div className="cards">
              {cards.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          ))}

        {waiting &&
          (asked.length === 0 ? (
            <p className="empty muted">
              Nothing waiting. Private events are the ones you have to ask
              about — the rest open straight from the link.
            </p>
          ) : (
            <ul className="asked">
              {asked.map((request) => (
                <li key={request.eventId}>
                  <div>
                    {/*
                      Named, not linked. The name is fair to show — they hold
                      the link, which is how they got here — but the event
                      itself answers 404 until the host says yes, and a link
                      that leads to nothing is worse than no link.
                    */}
                    <strong>{request.name}</strong>
                    <p className="muted">
                      {request.status === 'open'
                        ? `Asked ${ago(request.askedAt, now)}. Waiting on whoever made it.`
                        : 'Not opened up to you. The person who made the event is the one to ask.'}
                    </p>
                  </div>
                  <span className={`pip pip-${request.status}`}>
                    {request.status === 'open' ? 'Waiting' : 'No'}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        <SiteFooter />
      </main>
    </Shell>
  );
}
