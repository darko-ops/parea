/**
 * Activity — everything that has happened to you, and everything waiting on you.
 *
 * Two halves, in that order of urgency rather than of time. The bubble at the
 * top is the second half collapsed to a number: how many people are waiting on
 * an answer. Below it is the first half, which is a list to read and not a list
 * to work through.
 *
 * Not indexable: it lists what one person is in and what they have asked for.
 */

import { ActivityList } from '@/../app/components/ActivityList';
import { RequestBubble } from '@/../app/components/RequestBubble';
import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { activityFor } from '@/activity';
import { getDb } from '@/db';
import { askedToJoin, markInvitesSeen } from '@/invites';
import { pendingRequestsFor } from '@/requests';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Activity',
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

export default async function ActivityPage() {
  const db = getDb();
  const actorId = await currentActorId();
  const [items, asked, requests] = await Promise.all([
    activityFor(db, actorId),
    askedToJoin(db, actorId),
    pendingRequestsFor(db, actorId),
  ]);

  /*
   * Looking is what clears the badge.
   *
   * A write during a render, which is normally the wrong shape — but "mark as
   * read" is precisely a side effect of having read, and the alternative is a
   * client effect that POSTs on mount, i.e. a second round trip to record that
   * the first one happened. After the reads above, so a request that fails
   * halfway leaves the count intact rather than cleared without being shown.
   */
  await markInvitesSeen(db, actorId);
  const now = new Date();

  return (
    <Shell current="invites">
      <main className="main">
        <div className="main-head">
          <h1>Activity</h1>
        </div>

        {/*
          Requests first, because they are the only things here anybody has to
          do something about. Everything below has already happened.
        */}
        <RequestBubble requests={requests} />

        {asked.length > 0 && (
          <section className="panel">
            <h2>You asked to join</h2>
            <p className="panel-note">
              Waiting on whoever made them. You will find the answer here.
            </p>
            <ul className="asked">
              {asked.map((request) => (
                <li key={request.eventId}>
                  <div>
                    <strong>{request.name}</strong>
                    <p className="muted">Asked {ago(request.askedAt, now)}</p>
                  </div>
                  <span
                    className={`pip ${request.status === 'open' ? 'pip-open' : 'pip-declined'}`}
                  >
                    {request.status === 'open' ? 'Waiting' : 'Not this time'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/*
          Then the list. Derived from the rows that already exist rather than
          from a notifications table — see `activity.ts` for why, and for what
          that costs.
        */}
        <section className="panel">
          {/* Only when something sits above it. "Everything else" with nothing
              before it is a heading answering a question nobody asked. */}
          {(requests.length > 0 || asked.length > 0) && <h2>Lately</h2>}
          {/*
            The rows are handed down already worded and already dated: the
            relative time is rounded once, here, against the server's clock.
            Rounding it in the browser would make the first render disagree
            with the HTML it replaced, and React discards the tree when it does.
          */}
          <ActivityList
            items={items.map((item) => ({
              id: item.id,
              who: item.who,
              what: item.what,
              when: ago(item.at, now),
              href: item.href,
              image: item.image,
            }))}
          />
        </section>

        <SiteFooter />
      </main>
    </Shell>
  );
}
