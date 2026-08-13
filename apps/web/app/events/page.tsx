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
 * Not indexable: this lists what one person is in. `/` stays the public
 * landing page, and a crawler has no actor, so it never sees this.
 */

import { CreateCard } from '@/../app/components/CreateCard';
import { EventCard } from '@/../app/components/EventCard';
import { EventHero, isLive } from '@/../app/components/EventHero';
import { Shell } from '@/../app/components/Shell';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { eventsFor, type EventSort } from '@/events';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Home',
  robots: { index: false, follow: false },
};

const SORTS: { by: EventSort; label: string; href: string }[] = [
  { by: 'recent', label: 'Recent', href: '/events' },
  { by: 'place', label: 'By place', href: '/events?by=place' },
];

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const { by } = await searchParams;
  // Anything that is not the one alternative is the default, rather than an
  // error page: `?by=` is a thing people edit and share, and a 400 for a typo
  // in a sort order helps nobody.
  const sort: EventSort = by === 'place' ? 'place' : 'recent';

  const listings = await eventsFor(getDb(), await currentActorId(), sort);
  const now = new Date();
  const cards = await toCards(listings, now);

  /*
   * The hero is the live event, and only when sorted by recency.
   *
   * Under "by place" the order is alphabetical, so the first card is not the
   * most recent one and lifting it out of the list would put a random event at
   * the top under a label claiming it is the active one. The list is the
   * answer to the question that sort asks.
   */
  const hero = sort === 'recent' && cards[0] && isLive(cards[0], now) ? cards[0] : null;
  const rest = hero ? cards.slice(1) : cards;

  return (
    <Shell current="events">
      <main className="main">
        <div className="main-head">
          <h1>Home</h1>
          {/*
            Two links, not two buttons. The sort survives a reload, can be
            sent to somebody, and is marked with `aria-current` the same way
            the rail and the tabs are — one attribute doing the announcing and
            the styling, rather than a class that can fall out of step with it.
          */}
          {cards.length > 1 && (
            <nav className="segmented" aria-label="How to order these">
              {SORTS.map((option) => (
                <a
                  key={option.by}
                  href={option.href}
                  aria-current={sort === option.by ? 'page' : undefined}
                >
                  {option.label}
                </a>
              ))}
            </nav>
          )}
        </div>

        {hero && <EventHero event={hero} />}

        <div className="cards">
          {rest.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
          <CreateCard />
        </div>
      </main>
    </Shell>
  );
}
