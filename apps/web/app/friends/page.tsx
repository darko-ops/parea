/**
 * Friends.
 *
 * Not indexable: it lists people somebody knows, which is the one thing on
 * this product that would be worth scraping.
 */

import { FriendsView } from '@/../app/components/FriendsView';
import { Shell } from '@/../app/components/Shell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Friends',
  robots: { index: false, follow: false },
};

export default function FriendsPage() {
  return (
    <Shell current="friends">
      <FriendsView />
    </Shell>
  );
}
