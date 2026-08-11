/**
 * Find — groups by name, and your own events by place.
 *
 * The narrow half of the product, deliberately. §3's rule is that **groups can
 * be findable and photos never are**, so this searches a group namespace and
 * nothing else. There is no event search and no photo search, and adding
 * either would turn "possession of the link is the access model" into "type a
 * word and see whose wedding comes up".
 *
 * The by-place list is not an exception to that. It arranges events the viewer
 * is *already in*, so nothing is discovered — it is a second way to look at
 * what is already on the home screen, for someone who remembers where before
 * they remember what.
 */

import { Rail } from '@/../app/components/Rail';
import { FindView } from '@/../app/components/FindView';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Find',
  robots: { index: false, follow: false },
};

export default async function FindPage() {
  const listings = await eventsFor(getDb(), await currentActorId());

  // Grouped here rather than in the client: it is a pure transform of data
  // the server already has, and shipping the whole list to re-derive it in
  // the browser would be the same work done later and twice.
  const byPlace = new Map<string, { id: string; name: string }[]>();
  for (const listing of listings) {
    if (!listing.place) continue;
    byPlace.set(listing.place, [
      ...(byPlace.get(listing.place) ?? []),
      { id: listing.id, name: listing.name },
    ]);
  }

  return (
    <div className="shell">
      <Rail current="find" />
      <main className="main">
        <div className="main-head">
          <h1>Find</h1>
        </div>
        <FindView
          places={[...byPlace].map(([place, events]) => ({ place, events }))}
          unplaced={listings.filter((l) => !l.place).length}
        />
      </main>
    </div>
  );
}
