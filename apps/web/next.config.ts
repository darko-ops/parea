import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

/** Written once so the two private-path rules cannot drift apart. */
const NOINDEX = 'noindex, nofollow, noarchive, noimageindex';

const config: NextConfig = {
  // @parea/core ships TypeScript source rather than a build step.
  transpilePackages: [
    '@parea/core',
    '@parea/zip',
    '@parea/urls',
    '@parea/push',
    '@parea/upload',
    '@parea/autoselect',
    '@parea/cards',
  ],
  // Development-only routes are named `route.dev.ts` and are only recognised
  // as routes when this extension is registered. In a production build they
  // are not routes at all — the dev object-store endpoint cannot be deployed
  // by accident, rather than being deployed and refusing to serve.
  pageExtensions:
    process.env.NODE_ENV === 'production'
      ? ['ts', 'tsx']
      : ['dev.ts', 'ts', 'tsx'],
  /*
   * `/events` moved to `/albums`.
   *
   * A permanent redirect rather than a page that renders one, because links to
   * the old path are in browser histories and bookmarks and there is nothing
   * to render for them — and 308 lets a browser stop asking.
   *
   * The route is the only thing that moved. Every table, type and identifier
   * still says `event`, which is what the thing is called in the model; this
   * is the interface's word for it.
   */
  async redirects() {
    return [
      { source: '/events', destination: '/albums', permanent: true },
      { source: '/invites', destination: '/activity', permanent: true },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The event link IS the credential. Without this it rides along in
          // the Referer header to every third-party asset and outbound click.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      /*
       * Nothing behind a link is indexable — and possession of the link is the
       * entire access model, so a link that reaches a crawler is a set of
       * someone's photos in a search index.
       *
       * A header rather than only `robots.txt`, for three reasons: robots.txt
       * asks a crawler not to *fetch*, which does not stop a URL discovered
       * elsewhere from being indexed anyway; it covers no non-HTML response;
       * and it lives at a path an attacker can read to enumerate the private
       * prefixes. `X-Robots-Tag` travels with the response itself.
       *
       * `noimageindex` matters as much as `noindex` here. The photos are
       * served from the image Worker on another origin, so the page's own
       * directive is what tells a crawler not to index them.
       */
      {
        source: '/:prefix(e|event|group)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: NOINDEX }],
      },
      /*
       * The signed-in surfaces, each its own rule rather than another
       * alternative above: that alternation requires a segment after the
       * prefix and these paths have none.
       *
       * Every one of them lists what a particular person is in — `/account`
       * also names their email address — which is exactly the thing the link
       * model exists to keep out of an index.
       */
      ...['account', 'albums', 'find', 'activity'].map((root) => ({
        source: `/${root}/:path*`,
        headers: [{ key: 'X-Robots-Tag', value: NOINDEX }],
      })),
      {
        source: '/api/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

/*
 * Sentry, wrapped around the config rather than configured inside it.
 *
 * What this adds at build time is source maps. Without them a production stack
 * trace is a list of minified frames, which tells you a crash happened and
 * nothing about where — the same amount of information the log already had.
 *
 * `widenClientFileUpload` is off and `disableLogger` is on for the same reason
 * there is no client config: nothing of Sentry's should reach the browser
 * bundle. The org, project and token come from the Vercel integration and
 * exist only on Preview and Production, so a local `next build` skips the
 * upload rather than failing — which is what `silent` keeps quiet about.
 */
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: false,
  disableLogger: true,
  // Deleting them after upload is the point: a source map served from the
  // origin hands the whole codebase to anybody who opens devtools.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // A route that proxies Sentry's ingest through this origin, so an ad
  // blocker cannot silence reports. Off: it only matters for a browser SDK,
  // and there is deliberately not one.
  tunnelRoute: undefined,
});
