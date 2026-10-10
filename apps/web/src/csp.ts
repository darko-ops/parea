/**
 * The content security policy: what is enforced, what is still report-only,
 * and why each part is where it is.
 *
 * The event link *is* the credential. Nothing in this app writes
 * `dangerouslySetInnerHTML` or `innerHTML` from anything a person typed, so
 * there is no known injection to block — but "no known injection" is a
 * statement about today, and what a CSP buys is that a future one cannot post
 * the link somewhere. That is the whole threat model here: not defacement,
 * exfiltration of a URL.
 *
 * ## Scripts, enforced with a nonce
 *
 * Next inlines its bootstrap, so `script-src 'self'` alone is a blank page and
 * `'unsafe-inline'` protects nothing. Instead `proxy.ts` makes a nonce for
 * every page request and sends {@link pagePolicy}: only a script carrying that
 * nonce runs, and `'strict-dynamic'` lets the scripts it loads load theirs.
 * Next reads the nonce from the request's own CSP header and puts it on every
 * script it writes; the root layout puts it on the one it writes by hand.
 * Every page is drawn per request already (the layout reads headers), so a
 * nonce costs no static page.
 *
 * Files, `/_next/*` and the API never pass through the proxy's page branch and
 * get only {@link enforcedPolicy}, from `next.config.ts`. None of them is a
 * document that runs a script.
 *
 * ## Everything else, still report-only
 *
 * Images, connections, styles and fonts are reported, not enforced, by
 * {@link contentSecurityPolicy}: enforcing a wrong origin there is a page of
 * broken thumbnails, and the reports are the evidence for enforcing it later.
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

/** The request header the proxy hands the nonce to the layout in. */
export const NONCE_HEADER = 'x-nonce';

/**
 * Where browsers send what the policy blocked or would have: Sentry's
 * security endpoint, built from the DSN the server already reports errors to.
 * Null when there is no DSN, and then the policy reports nowhere.
 */
export function cspReportUri(): string | null {
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

function withReport(directives: string[]): string {
  const report = cspReportUri();
  return [...directives, ...(report ? [`report-uri ${report}`] : [])].join('; ');
}

/**
 * The directives that cannot break a page: no plugins, no framing of this
 * site by another (the attack `X-Frame-Options` already refuses), no `<base>`
 * that could rewrite where every relative link and form points, and forms that
 * submit only here.
 */
const STRUCTURE = ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"];

/** Enforced on every response. */
export function enforcedPolicy(): string {
  return withReport(STRUCTURE);
}

/**
 * Enforced on every page: the structure above, and scripts only by nonce.
 *
 * `'self'` is ignored beside `'strict-dynamic'` by every browser that knows
 * the latter, and kept for one that does not. `'unsafe-eval'` in development
 * only, where React uses `eval` to rebuild call stacks.
 */
export function pagePolicy(nonce: string, dev = process.env.NODE_ENV === 'development'): string {
  return withReport([
    ...STRUCTURE,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
  ]);
}

/** Report-only: everything not yet enforced, so its violations are seen first. */
export function contentSecurityPolicy(): string {
  const image = process.env.IMAGE_BASE_URL?.replace(/\/$/, '') ?? '';
  const r2 = 'https://*.r2.cloudflarestorage.com';

  return withReport([
    // Everything not named below comes from here or nowhere.
    "default-src 'self'",
    // Enforced by nonce in `pagePolicy`. Named here only so that scripts do
    // not fall back to `default-src` and report every one Next writes.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${image} ${r2}`.replace(/\s+/g, ' ').trim(),
    `connect-src 'self' ${image} ${r2}`.replace(/\s+/g, ' ').trim(),
    "font-src 'self' data:",
    ...STRUCTURE,
  ]);
}
