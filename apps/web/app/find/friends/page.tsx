/**
 * Find Friends — the other half of Find, and the half nobody can type.
 *
 * Under `/find` rather than beside it, because it is the same errand at a
 * different angle: the box on `/find` answers *who is called this*, and this
 * page answers *who is here that I know*. A route at the top level would make
 * it look like a fifth section of the product.
 *
 * `/friends` is a different page and stays one — that is the list of people you
 * already have, plus the asks waiting on you. This is the list of people you do
 * not have yet, which is a recommendation and so a different kind of claim.
 *
 * Not indexable, for `/friends`' reason and more so: it names people somebody
 * may know, which is the one thing on this product worth scraping.
 *
 * Everything on it is a client component. The verification is two round trips
 * with a field between them, and the list has to be refetched the moment the
 * second one lands — a server component would have to be re-rendered by a
 * navigation to show the result of a form on itself.
 */

import { FindFriendsView } from '@/../app/components/FindFriendsView';
import { Shell } from '@/../app/components/Shell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Find friends',
  robots: { index: false, follow: false },
};

export default function FindFriendsPage() {
  /*
   * `current="find"` rather than nothing.
   *
   * This page is reached from the corner of Find and is a page of it, so the
   * rail marking Find is telling the truth about where somebody is. `Shell`'s
   * note warns against marking a row for a page that merely descends from it —
   * an album under Albums — and the distinction is whether the row's link goes
   * somewhere else: from here, Find is the way back, which is exactly what a
   * marked row means.
   */
  return (
    <Shell current="find">
      <FindFriendsView />
    </Shell>
  );
}
