/**
 * Search — one box over the things this person can already reach, plus the two
 * namespaces the product allows to be looked up.
 *
 * §3's rule is that **groups can be findable and photos never are**, and this
 * page is where that rule is most visible. What is matched here:
 *
 *   - your own albums, filtered in the browser over a list the server already
 *     decided you may see. Nothing is discovered;
 *   - your own friends, the same;
 *   - anybody by handle, prefix-only, which is what makes a person findable
 *     enough to be asked and no further;
 *   - findable groups, which return a door and never what is inside.
 *
 * With nothing typed it suggests people instead: friends of your friends, who
 * are the one suggestion this product makes and the weakest one available —
 * somebody you could already reach by asking the friend you have in common.
 *
 * There is no album search beyond your own and no photo search at all. Adding
 * either would turn "possession of the link is the access model" into "type a
 * word and see whose wedding comes up".
 */

import { Shell } from '@/../app/components/Shell';
import { FindView } from '@/../app/components/FindView';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { friendsOf, suggestionsFor } from '@/friends';
import { groupsFor } from '@/groups';
import { imageSrc } from '@/images';
import { searchable } from '@/search';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Search',
  robots: { index: false, follow: false },
};

export default async function FindPage() {
  const db = getDb();
  const actorId = await currentActorId();
  const [listings, friends, suggested, groups] = await Promise.all([
    eventsFor(db, actorId),
    friendsOf(db, actorId),
    suggestionsFor(db, actorId),
    // The groups this person is already in. Not a search — the page names
    // Groups as one of the three things it finds, and a heading that only ever
    // fills up after you type is a heading that has to be discovered.
    groupsFor(db, actorId),
  ]);

  /*
   * The albums, with the string they are matched against built here.
   *
   * Server-side for the same reason the home screen builds its haystack there:
   * the text a query is matched against and the text on the row have to be
   * derived once, or they come to disagree about whether the place counts.
   */
  const albums = await Promise.all(
    listings.map(async (listing) => ({
      id: listing.id,
      name: listing.name,
      place: listing.place,
      caption: listing.caption,
      thumb: listing.mosaic[0]
        ? await imageSrc(
            {
              eventId: listing.id,
              storageKey: listing.mosaic[0].storageKey,
              contentHash: listing.mosaic[0].hash
                ? Buffer.from(listing.mosaic[0].hash, 'hex')
                : null,
            },
            'thumb',
            listing.capEpoch,
          )
        : null,
      haystack: searchable(listing),
    })),
  );

  return (
    <Shell current="find">
      <main className="main">
        <div className="main-head">
          <h1>Search</h1>
        </div>
        <FindView
          albums={albums}
          friends={friends}
          suggested={suggested}
          groups={groups.map((g) => ({ id: g.id, name: g.name, role: g.role }))}
        />
      </main>
    </Shell>
  );
}
