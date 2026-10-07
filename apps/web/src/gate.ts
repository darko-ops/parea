/**
 * Which pages someone may see without an account: the few on this list.
 *
 * Everything else on parea.photos needs somebody signed in (6 October 2026).
 * Three layers say so, and this list is the one they share:
 *
 * - `proxy.ts` sends a request with no session cookie at all straight to
 *   sign-in — the cheap, optimistic check the framework recommends there.
 * - The root layout asks the database whether the cookie is an account (a
 *   guest has a cookie too) and, if not, shows the sign-in card on `/` and
 *   sends every other page to `/account?next=…`.
 * - The access policy refuses every roll to anybody without an account, so a
 *   page that slipped past both still has nothing to show.
 *
 * Public, and why:
 * - `/account` — the sign-in page itself.
 * - `/privacy`, `/terms` — Apple and the SMS carriers require them reachable
 *   without signing in, and anybody deciding whether to sign up reads them.
 * - `/safety` — the published contact App Review checks (Guideline 1.2).
 * - `/texts` — the SMS consent wording the carrier campaign points to.
 * - `/e/…` — a share link; its route sends a signed-out visitor through
 *   sign-in and back, and answers chat-app link previews with a card.
 */

const PUBLIC_PAGES = new Set(['/account', '/privacy', '/terms', '/safety', '/texts']);

export function isPublicPage(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return PUBLIC_PAGES.has(path) || path.startsWith('/e/');
}

/** Where a signed-out visitor to `path` is sent: sign-in, then back here. */
export function signInFor(pathWithQuery: string): string {
  return `/account?next=${encodeURIComponent(pathWithQuery)}`;
}

/** The request header `proxy.ts` uses to tell the layout which page this is. */
export const PATH_HEADER = 'x-parea-path';
