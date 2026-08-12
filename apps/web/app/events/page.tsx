/**
 * The web's home, which it did not have.
 *
 * Until now the web app's front door was the create form: you landed on "what
 * was it?" whether or not you had ever made anything, and an event you added
 * photos to last week was unreachable unless you still had the message
 * someone sent you. The app grew three tabs for this; the web got nothing, so
 * "two clients, one protocol" was true of the API and false of the product.
 *
 * Ordered most recently added-to first, because a home screen is about what is
 * happening and the event people are still putting photos into is the one
 * worth being near the top.
 *
 * Not indexable: this lists what one person is in. `/` stays the public
 * landing page, and a crawler has no actor, so it never sees this.
 */

import { EventCard } from '@/../app/components/EventCard';
import { Rail } from '@/../app/components/Rail';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your events',
  robots: { index: false, follow: false },
};

export default async function EventsPage() {
  const listings = await eventsFor(getDb(), await currentActorId());
  const cards = await toCards(listings);

  return (
    <div className="shell">
      <Rail current="events" />

      <main className="main">
        <div className="main-head">
          <h1>Events</h1>
          {cards.length > 1 && (
            <span className="muted">Most recently added to first</span>
          )}
        </div>

        <div className="cards">
          {cards.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}

          {/*
            The last cell is an affordance rather than an event, so the grid
            never reads as finished. It is also the entire empty state: with
            no events this is the only cell, and it says what the product does
            rather than apologising for having nothing to show.
          */}
          <a href="/" className="card-new">
            <strong>Start an event</strong>
            <span>
              Name it, say when it was, send the link. Nothing to sign up for
              at the other end to look.
            </span>
          </a>
        </div>
      </main>
    </div>
  );
}
