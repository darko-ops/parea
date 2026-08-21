/**
 * Somebody else's page.
 *
 * Reached from a search result, from the friends list, from a suggestion —
 * anywhere a name is drawn. Before this, all of those went to `/friends`,
 * which answers "who do I know" when the question was "who is this".
 *
 * Laid out as your own profile is, minus Edit and with the events narrowed to
 * the ones you can both see. See `PersonView` for what the two empty states
 * mean, and `people.ts` for who has no page at all.
 *
 * Signed in only, and a 404 for everybody the search box would not have
 * returned.
 *
 * Not indexable, and more emphatically than most: it is a page about a named
 * person, which is the last thing in this product that should be in an index.
 */

import { notFound, redirect } from 'next/navigation';

import { PersonView } from '@/../app/components/PersonView';
import { Shell } from '@/../app/components/Shell';
import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { eventsWithBoth, profileFor } from '@/people';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

/**
 * The handle, from the URL rather than from the database.
 *
 * A title is worth having — an open tab that says "Every photo from everyone
 * who was there" is one nobody can find again — and it is worth *not* paying a
 * second query for, since this runs alongside the page's own load. The handle
 * is what was asked for, so it is what the tab says, whether or not anybody is
 * behind it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return {
    title: `@${decodeURIComponent(handle)}`,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const db = getDb();
  const actorId = await currentActorId();

  /*
   * A guest with a link to one event is not somebody who gets to look people
   * up. The same test `/api/people` applies, so the two doors agree.
   */
  if (!actorId || !(await isSignedIn(db, actorId))) notFound();

  const person = await profileFor(db, actorId, decodeURIComponent(handle));
  if (!person) notFound();

  /*
   * Your own handle is your own profile.
   *
   * This page is the other-person version of `/account`, and the two would
   * disagree about you: the event list here is "events we are both in", which
   * for yourself is empty, so your own page would say Account Private about
   * you. Sending you to the real one is the only answer that is not a worse
   * version of a page you already have.
   */
  if (person.standing === 'self') redirect('/account');

  const shared = await eventsWithBoth(db, actorId, person.actorId);

  return (
    <Shell>
      <main className="main">
        <PersonView
          person={{
            actorId: person.actorId,
            handle: person.handle,
            displayName: person.displayName,
            bio: person.bio,
            avatar: await avatarUrl(person.avatarKey),
            standing: person.standing,
            requestId: person.requestId,
          }}
          // The same cards the home screen and your own profile draw, from the
          // same builder: an event should not look like a different kind of
          // thing depending on which page it is on.
          events={await toCards(shared)}
        />
      </main>
    </Shell>
  );
}
