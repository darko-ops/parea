/**
 * Where the `+` sheet's Moment goes. A static segment, so it wins over
 * `/moments/[id]` for this one path.
 */

import { AddMoment } from '@/../app/components/AddMoment';
import { Shell } from '@/../app/components/Shell';

export const metadata = {
  title: 'New moment',
  robots: { index: false, follow: false },
};

export default function NewMomentPage() {
  return (
    <Shell>
      <AddMoment />
    </Shell>
  );
}
