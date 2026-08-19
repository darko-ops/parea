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
import { HomeView } from '@/../app/components/HomeView';
import { Shell } from '@/../app/components/Shell';
import { avatarUrl, accountFor } from '@/accounts';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { peopleAround } from '@/people';
import { searchable } from '@/search';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Home',
  robots: { index: false, follow: false },
};

/**
 * "Evening, Nadia" — the time of day, on the server's clock.
 *
 * Worded here rather than in the browser for the reason every other time on
 * this page is: the two clocks disagree, and React discards a tree whose text
 * does not match the HTML it is hydrating. The server's zone is not the
 * reader's, which makes this occasionally wrong by a few hours for somebody
 * travelling — a greeting is allowed to be wrong in that way, and a page that
 * flickered on every load is not.
 */
function greetingFor(name: string | null, now: Date): string | null {
  if (!name?.trim()) return null;
  const hour = now.getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return `${part}, ${name.trim().split(/\s+/)[0]}`;
}

export default async function EventsPage() {
  const db = getDb();
  const actorId = await currentActorId();
  const [listings, account, nearby] = await Promise.all([
    eventsFor(db, actorId),
    // For the greeting only. Null for a browser that has never signed in,
    // which is the case this page renders without a greeting at all.
    actorId ? accountFor(db, actorId) : Promise.resolve(null),
    peopleAround(db, actorId),
  ]);
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
        <HomeView
          haystacks={haystacks}
          greeting={greetingFor(account?.displayName ?? null, now)}
          people={await Promise.all(
            nearby.map(async (person) => ({
              actorId: person.actorId,
              handle: person.handle,
              name: person.name,
              // Presigned here, like every other avatar that crosses this
              // boundary. The key does not cross it.
              avatar: await avatarUrl(person.avatarKey),
              eventIds: person.eventIds,
            })),
          )}
          footer={<CreateCard />}
        >
          {/*
            The id sits on a wrapper so `EventCard` stays a server component
            with no idea it is inside two filters.
          */}
          {cards.map((event) => (
            <div key={event.id} data-event={event.id}>
              <EventCard event={event} />
            </div>
          ))}
        </HomeView>
      </main>
    </Shell>
  );
}
