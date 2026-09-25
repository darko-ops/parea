/**
 * Universal Links — design §9, and the server half of the app's entitlement.
 *
 * The app declares `applinks:parea.photos`; iOS only believes it after
 * fetching this file and finding the app's own identifier in it. Until then a
 * tapped link opens Safari, which looks like a product decision rather than a
 * missing file.
 *
 * A route rather than a static file because the Apple Team ID is deployment
 * configuration, not source: the same repository has to be able to serve a
 * personal team's build and an organisation's without an edit.
 *
 * No extension on the path, and `application/json` regardless — that is what
 * Apple fetches and it will not follow a redirect to find it.
 */

import { NextResponse } from 'next/server';

import { appIdentifier, IOS_BUNDLE_ID } from '@/deeplinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const appID = appIdentifier();
  // Absent rather than wrong. Apple's CDN caches this aggressively, and a
  // file naming the wrong team is a link that stays broken long after the
  // configuration is fixed.
  if (!appID) return new NextResponse('not configured', { status: 404 });

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appID],
            // Only the link people are actually sent. `/event/<id>` is
            // reachable in a browser because the token was already exchanged
            // for a cookie, and carries nothing the app could use.
            components: [{ '/': '/e/*', comment: 'event links' }],
          },
        ],
      },
      /*
       * The other half of the app's passkey entitlement — design §3.
       *
       * This was declared and empty, on the honest grounds that the app had no
       * shared web credentials. It has one now: a passkey is bound to a domain,
       * and iOS will not let an app assert for `parea.photos` unless this file
       * names it here *and* the app declares `webcredentials:parea.photos` in
       * `associatedDomains`. Both halves or neither — one without the other is a
       * Face ID prompt that never appears, with nothing logged to say why.
       *
       * The same identifier as the links above, because it is the same app.
       */
      webcredentials: { apps: [appID] },
    },
    {
      headers: {
        'content-type': 'application/json',
        // Long enough that the file is not fetched on every install, short
        // enough that a Team ID correction is not a week-long outage.
        'cache-control': 'public, max-age=3600',
        'x-parea-bundle-id': IOS_BUNDLE_ID,
      },
    },
  );
}
