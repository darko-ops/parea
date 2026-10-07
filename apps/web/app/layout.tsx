import type { Metadata } from 'next';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { SignInPage } from '@/../app/components/SignInPage';
import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { isPublicPage, PATH_HEADER, signInFor } from '@/gate';
import { currentActorId } from '@/session';
import { SITE } from '@/site';
import { THEME_COOKIE } from '@/theme';
import './globals.css';

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
  /*
   * The brand in every title. "Privacy" alone is what a search result said,
   * which names nothing — and the front page, which is the one result anybody
   * searching for the product should see, said the tagline without the name.
   */
  title: { default: `Parea — ${TITLE}`, template: '%s · Parea' },
  description: DESCRIPTION,
  applicationName: 'Parea',
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

/**
 * Dark unless the reader chose light on the account page — the app's default
 * too.
 *
 * The page is served dark, and a line of script in the head — before the body
 * is parsed, so before anything is painted — turns it light for somebody who
 * chose that. Reading the cookie on the server instead would have made every
 * page, the static ones included, render per request to decide one attribute.
 * `suppressHydrationWarning` because that script changes the attribute React
 * rendered, on purpose.
 */
const CHOOSE = `try{if(document.cookie.split('; ').indexOf('${THEME_COOKIE}=light')>-1)document.documentElement.dataset.theme='light'}catch(e){}`;

/**
 * Who the site is, for a search engine — the name it shows over the result and
 * the site it belongs to.
 *
 * On every page rather than only the front one because it says nothing about
 * any page: a name, an address and an icon. The private pages it also lands on
 * are `noindex`, so it is never read there.
 */
const STRUCTURED = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: 'Parea',
      url: SITE,
      logo: `${SITE}/api/og`,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      name: 'Parea',
      url: SITE,
      description: DESCRIPTION,
      publisher: { '@id': `${SITE}/#organization` },
    },
  ],
}).replace(/</g, '\\u003c');

/**
 * Whether this page may be drawn for whoever is asking — the real check behind
 * `proxy.ts`'s optimistic one. A cookie is not an account (a guest has one), so
 * the database is asked. See `@/gate`.
 */
async function gate(): Promise<'show' | 'sign-in'> {
  const path = (await headers()).get(PATH_HEADER);
  // No path means the proxy did not run for this request (a file, the
  // framework's own routes): nothing to gate.
  if (!path) return 'show';
  const pathname = path.split('?')[0]!;
  if (isPublicPage(pathname)) return 'show';
  const actorId = await currentActorId().catch(() => null);
  if (actorId && (await isSignedIn(getDb(), actorId).catch(() => false))) return 'show';
  if (pathname === '/') return 'sign-in';
  redirect(signInFor(path));
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const shown = await gate();
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHOOSE }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED }} />
      </head>
      <body>{shown === 'show' ? children : <SignInPage />}</body>
    </html>
  );
}
