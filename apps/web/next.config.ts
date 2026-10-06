import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

/** Written once so the two private-path rules cannot drift apart. */
const NOINDEX = 'noindex, nofollow, noarchive, noimageindex';

/**
 * The content security policy, and why it ships report-only.
 *
 * The event link *is* the credential. Nothing in this app writes
 * `dangerouslySetInnerHTML` or `innerHTML`, so there is no known injection to
 * block — but "no known injection" is a statement about today, and what a CSP
 * buys is that a future one cannot post the link somewhere. That is the whole
 * threat model here: not defacement, exfiltration of a URL.
 *
 * Report-only to begin with, because enforcing a wrong policy is a blank page
 * and this one cannot be fully verified from a build. Next inlines its
 * bootstrap script, and the honest way to tighten `script-src` is nonces
 * through the proxy (`proxy.ts`), which runs on `/api` only and sets none. So the
 * first version allows what Next needs, reports what it sees, and the console
 * is the evidence for narrowing it later.
 *
 * ## The origins, and why each
 *
 * Photo bytes never come from this origin — that is the point of §2 — so the
 * image Worker has to be named or every thumbnail is a violation. Uploads go
 * straight from the browser to a presigned R2 URL, which makes R2 a
 * `connect-src` rather than an `img-src`; a wildcard covers it because the
 * account subdomain is not worth pinning in a public header and is already
 * visible in every presigned URL. The zip Worker needs nothing: a download is
 * a top-level navigation, which no directive here governs.
 *
 * Mapbox is absent on purpose. `/api/places` calls it from the server, so the
 * browser never does, and adding it would widen the policy for a request the
 * page cannot make.
 */
function contentSecurityPolicy(): string {
  const image = process.env.IMAGE_BASE_URL?.replace(/\/$/, '') ?? '';
  const r2 = 'https://*.r2.cloudflarestorage.com';

  return [
    // Everything not named below comes from here or nowhere.
    "default-src 'self'",
    /*
     * `unsafe-inline` is Next's bootstrap and nothing else, and it is the
     * directive this policy exists to eventually tighten. It is also why the
     * header is report-only: enforcing this as written would protect less
     * than it appears to, and pretending otherwise is worse than reporting.
     */
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${image} ${r2}`.replace(/\s+/g, ' ').trim(),
    `connect-src 'self' ${image} ${r2}`.replace(/\s+/g, ' ').trim(),
    "font-src 'self' data:",
    // No plugins, no embedding, and no <base> rewriting where links point.
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Where browsers send what the policy above would have blocked: Sentry's
 * security endpoint, built from the DSN the server already reports errors to.
 *
 * The policy said "the console is the evidence for narrowing it later" — but
 * nobody reads other people's consoles, so for its whole life it collected
 * nothing. Null when there is no DSN, and then the policy simply reports
 * nowhere, as before.
 */
function cspReportUri(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\//, '');
    if (!url.username || !project) return null;
    return `${url.protocol}//${url.host}/api/${project}/security/?sentry_key=${url.username}`;
  } catch {
    return null;
  }
}

/**
 * The part of the policy that cannot break a page, enforced.
 *
 * None of these touch what Next needs to run: no plugins, no framing of this
 * site by another (the attack `X-Frame-Options` already refuses), no `<base>`
 * that could rewrite where every relative link and form points, and forms that
 * submit only here. They were report-only alongside everything else, so an
 * injected `<base>` or an `<object>` would have been reported and allowed.
 */
function enforcedPolicy(): string {
  const report = cspReportUri();
  return [
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(report ? [`report-uri ${report}`] : []),
  ].join('; ');
}

const config: NextConfig = {
  // Says nothing a visitor needs, and names the framework to anybody probing.
  poweredByHeader: false,
  // @parea/core ships TypeScript source rather than a build step.
  transpilePackages: [
    '@parea/core',
    '@parea/zip',
    '@parea/urls',
    '@parea/push',
    '@parea/upload',
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
   * `/albums` is back to `/events`, and there is deliberately no redirect.
   *
   * The home route was `/events`, moved to `/albums` on 14 Aug as a permanent
   * 308, and has now moved back — the interface calls these events again, so
   * the path does too.
   *
   * **A 308 is the reason `/albums` may not redirect here.** For six days this
   * config told browsers, permanently, that `/events` is `/albums`. A browser
   * that heard it has cached that with no expiry, and a `/albums → /events`
   * rule would complete a circle it cannot get out of: `/events` → cached 308
   * → `/albums` → 307 → `/events` → cached 308, forever, with no request
   * reaching us to break it. Clearing the site's storage would be the only fix
   * and nobody knows to do that.
   *
   * So `/albums` keeps *serving the page* instead — see `app/albums/page.tsx`.
   * Anybody carrying the stale redirect lands on their home screen rather than
   * in a loop, and everybody else gets `/events` directly. That shim can go
   * once enough time has passed that no live browser holds the old 308.
   *
   * `/invites` stays: it was a 308 to a path that has not moved since.
   */
  /*
   * The apex to `www`, in the app rather than at the edge.
   *
   * Vercel can redirect a domain to another, and did — a project-level 308 on
   * `parea.photos`. The trouble is that it is all-or-nothing: there is no way
   * to exempt a path, and two paths must not be redirected.
   *
   * `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
   * are fetched by iOS and by Android to decide whether this app may claim
   * links on a host, and *neither platform follows a redirect to find them*.
   * So while the edge redirect stood, the apex could never be verified: every
   * `parea.photos/e/<token>` link opened a browser, whatever the app declared.
   * Both platforms match the host before fetching anything, so the apex has to
   * be claimed and therefore has to serve its own association files.
   *
   * Everything else still goes to `www`, which is the canonical host — one
   * place for a session cookie to live, and one URL for a page.
   *
   * `has.value` is compiled as `new RegExp('^' + value + '$')`, so this cannot
   * match `www.parea.photos` and cannot loop. The dot is escaped because the
   * value is a regex and an unescaped one would also match `pareaXphotos`.
   *
   * Before `/invites`, so apex traffic lands on `www` in one hop and is
   * redirected once more from there, rather than bouncing within the apex and
   * then leaving it.
   */
  async redirects() {
    const apex = [{ type: 'host' as const, value: 'parea\\.photos' }];
    return [
      // The bare host. `/:path(...)` below cannot match an empty path, so the
      // root needs saying separately.
      {
        source: '/',
        has: apex,
        destination: 'https://www.parea.photos/',
        permanent: true,
      },
      {
        source: '/:path((?!\\.well-known/).*)',
        has: apex,
        destination: 'https://www.parea.photos/:path',
        permanent: true,
      },
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
          // Report-only, and `frame-ancestors` restates the line above it in
          // the modern header — the two are kept together so that dropping
          // `X-Frame-Options` later is one edit rather than an omission.
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [contentSecurityPolicy(), ...(cspReportUri() ? [`report-uri ${cspReportUri()}`] : [])].join('; '),
          },
          { key: 'Content-Security-Policy', value: enforcedPolicy() },
          /*
           * HTTPS on every host under the domain, for two years. Vercel sends
           * this without `includeSubDomains`, which left `img.` and `zip.` to
           * their own devices; all of them are HTTPS already, so this costs
           * nothing. `preload` is not here: it asks browsers to hard-code the
           * domain as HTTPS-only, which is slow to undo, and is the owner's
           * decision.
           */
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          /*
           * Features the site never uses, switched off, so that no script on it
           * — ours by mistake or anyone's by injection — can ask for them.
           * The camera is for the app's code scanner, which is native.
           */
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
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
      /*
       * `groups` is not covered by the `group` alternative above — that one
       * requires a segment after the prefix, so it matches `/group/<id>` and
       * nothing else. `/groups` is a different path listing what one person
       * belongs to, and it needs its own entry.
       */
      // `albums` is the old home path, still serving the page rather than
      // redirecting — see `app/albums/page.tsx`. Both need the header while
      // both answer.
      ...['account', 'events', 'albums', 'find', 'activity', 'groups'].map((root) => ({
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
