import type { Metadata } from 'next';
import './globals.css';

/**
 * The site's own origin.
 *
 * A constant rather than configuration, for the reason `deeplinks.ts` gives
 * about the bundle identifiers: it is not configurable. The app claims
 * `applinks:parea.photos` and `applinks:www.parea.photos` in `app.json`, and a
 * deployment serving a different canonical origin would be pointing every card
 * it produces at somewhere the app does not answer for.
 *
 * It is here for `metadataBase`, which is what turns the relative image path
 * below into the absolute URL an unfurler needs. Without one Next guesses from
 * `VERCEL_URL` — the per-deployment hostname, which changes on every push and
 * is not the address anybody's link points at.
 */
const SITE = 'https://parea.photos';

/**
 * What the product looks like as a link.
 *
 * There was no `og:image` here at all, and the one that exists — `/api/og` —
 * was reachable only through `preview.ts`, which serves cards for `/e/<token>`
 * share links to the handful of fetchers that unfurl them. So a *shared event*
 * had a picture and the product itself had none: pasted into a chat, listed by
 * a search engine, or offered by a browser as a suggestion, Parea arrived as a
 * line of text.
 *
 * The image is the same one for every page and has nothing in it about any
 * event — see the route. That is what makes putting it on the root safe: it is
 * the app icon and a word, and there is nothing in it to leak from a page a
 * crawler happens to be able to see.
 *
 * `summary` rather than `summary_large_image`, because the card is square. A
 * large-image card in a 2:1 frame would crop the mark, which is the one thing
 * in there that must survive.
 */
const TITLE = 'Every photo from everyone who was there';
const DESCRIPTION =
  'Parea collects the photographs from one thing that happened and gives ' +
  'everyone who was there the full set.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Parea',
    /*
     * No `og:url`. It would be the same string on every page, which tells an
     * unfurler that `/privacy` and `/terms` are both the site's front door —
     * and the only thing it would buy is a canonical the fetched URL already
     * is. `metadataBase` is what the absolute image path needs, and that is a
     * different job.
     */
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/api/og', width: 640, height: 640, alt: 'Parea' }],
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/api/og'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
