/**
 * The web's home, which it did not have.
 *
 * Until now the web app's front door was the create form: you landed on "what
 * was it?" whether or not you had ever made anything, and an event you added
 * photos to last week was unreachable unless you still had the message
 * someone sent you. The app grew three tabs for this; the web got nothing, so
 * "two clients, one protocol" was true of the API and false of the product.
 *
 * Cards, all the same size. There was briefly a hero — the event being added
 * to right now, given a larger picture and a picker of its own — and it made
 * the page two things: one event presented, and the rest listed. A grid where
 * every cell is the same says what it means, which is that these are eleven
 * evenings and you know which one you are looking for.
 *
 * The same card as the You page and Invites, deliberately: one object, one
 * drawing of it, and `shell.test.ts` asserts every grid of events uses it.
 *
 * One order, newest activity first. There was briefly a second — alphabetical
 * by place — offered as a segmented control beside the heading. It was a
 * whole-list re-ordering to answer one question ("the Greece one"), and search
 * answers that question better and without moving anything: the list stays a
 * timeline, which is the thing a home screen is for.
 *
 * Not indexable: this lists what one person is in. `/` stays the public
 * landing page, and a crawler has no actor, so it never sees this.
 */

import { CreateCard } from '@/../app/components/CreateCard';
import { EventCard } from '@/../app/components/EventCard';
import { SearchEvents } from '@/../app/components/SearchEvents';
import { Shell } from '@/../app/components/Shell';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { searchable } from '@/search';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Home',
  robots: { index: false, follow: false },
};

export default async function EventsPage() {
  const listings = await eventsFor(getDb(), await currentActorId());
  const now = new Date();
  const cards = await toCards(listings, now);

  /*
   * Built from the listings rather than from the cards.
   *
   * The card stopped drawing the place, and the search did not stop matching
   * it: typing "greece" is what replaced the By place list, and that is worth
   * more than the rule that a query only matches visible text. Reading it from
   * the listing keeps the place out of `CardEvent` altogether, so nothing is
   * carried into the component that the component does not draw.
   */
  const haystacks = Object.fromEntries(
    listings.map((listing) => [listing.id, searchable(listing)]),
  );

  return (
    <Shell current="events">
      <main className="main">
        <SearchEvents
          haystacks={haystacks}
          heading={<h1>Home</h1>}
          footer={<CreateCard />}
        >
          {/*
            The id sits on a wrapper so `EventCard` stays a server component
            with no idea it is inside a search.
          */}
          {cards.map((event) => (
            <div key={event.id} data-event={event.id}>
              <EventCard event={event} />
            </div>
          ))}
        </SearchEvents>
      </main>
    </Shell>
  );
}
