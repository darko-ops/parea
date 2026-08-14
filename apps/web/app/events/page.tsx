/**
 * The web's home, which it did not have.
 *
 * Until now the web app's front door was the create form: you landed on "what
 * was it?" whether or not you had ever made anything, and an event you added
 * photos to last week was unreachable unless you still had the message
 * someone sent you. The app grew three tabs for this; the web got nothing, so
 * "two clients, one protocol" was true of the API and false of the product.
 *
 * A hero, then the cards. One event is usually the one being added to right
 * now, and it is the only one worth a large picture and a picker; the rest are
 * cards, because an event is recognised by its photographs and a 58px strip of
 * them is not enough to do it with. Density was tried and lost to that — the
 * rows fitted nine events on a screen and made all nine harder to tell apart.
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
import { EventHero, isLive } from '@/../app/components/EventHero';
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

  // The hero is the live event, and only if it is the one at the top — which
  // it is, since the list is ordered by activity. Anything else would be a
  // large card labelled "still coming in" above fresher things than itself.
  const hero = cards[0] && isLive(cards[0], now) ? cards[0] : null;

  /*
   * Built here, not in the browser: the text a query is matched against is the
   * same text the card draws, and deriving it twice is how the two come to
   * disagree about whether the place counts.
   */
  const haystacks = Object.fromEntries(cards.map((event) => [event.id, searchable(event)]));

  return (
    <Shell current="events">
      <main className="main">
        <SearchEvents
          haystacks={haystacks}
          heading={<h1>Home</h1>}
          hero={hero && <EventHero event={hero} />}
          heroId={hero?.id}
          footer={<CreateCard />}
        >
          {/*
            Every event, including the one the hero is drawing — a search has
            to be able to find that one too. Its card is dropped from the grid
            while the hero is up; see `heroId`.

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
