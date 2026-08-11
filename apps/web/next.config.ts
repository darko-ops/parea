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
      ...['account', 'events', 'find'].map((root) => ({
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

export default config;
