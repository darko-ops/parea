/**
 * A moment is about to be made: start what will scan it.
 *
 * Asked for by the composer as it opens, and not waited on. The scan behind
 * Share goes through the deriver, which is stopped between uploads and took
 * about three seconds to start under the Share that woke it — see
 * `wakeScanner`. Started here, that happens while somebody is choosing a photo.
 *
 * Only for somebody who could post one, so this is not a public switch for
 * keeping a machine awake.
 */

import { NextResponse } from 'next/server';

import { wakeScanner } from '@/safety';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST() {
  if (!(await currentAccountActorId())) {
    return NextResponse.json({ error: 'no_actor' }, { status: 403 });
  }
  await wakeScanner();
  return new NextResponse(null, { status: 204 });
}
