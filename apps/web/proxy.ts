/**
 * Refuses a browser request that changes something when it came from another
 * site.
 *
 * This app had no proxy (Next 16's name for middleware), on purpose: access is
 * decided in each route, by `guard()`, and a layer in front of it was one more
 * place for that decision to live. This is not an access decision. It is the
 * one question no route can answer about itself — did the *browser* send this
 * because the person was on Parea, or because a page somewhere else made it?
 *
 * Without it, sign-in could be forced. The session cookie is `SameSite=Lax`,
 * so a cross-site form cannot *carry* somebody's cookie; but it can *receive*
 * one. A page elsewhere could auto-submit a `text/plain` form to
 * `/api/account/session` whose body parses as the attacker's own email and
 * code — `request.json()` does not care what the content type says — and the
 * top-level navigation would come back with the attacker's session cookie set
 * in the victim's browser. Everything they uploaded after that went into the
 * attacker's account, and a guest's own identity was overwritten for good.
 *
 * How it decides, in order:
 *
 * - `Sec-Fetch-Site` — sent by every current browser, and not settable by a
 *   page. `same-origin`, `same-site` (another parea.photos host) and `none`
 *   (typed, bookmarked) pass; `cross-site` does not.
 * - `Origin`, for a browser old enough not to send the first — it is sent on
 *   every cross-origin POST. Ours pass; anything else, and `null`, does not.
 * - Neither header: not a browser. The phone app, a server, `curl`. There is
 *   no ambient cookie a page elsewhere could spend on those, which is the only
 *   thing this defends against, so they pass untouched.
 *
 * Only `/api`, and only methods that change something. Reading is not what
 * this is for, and a GET that changed state would be the bug to fix.
 */

import { NextResponse, type NextRequest } from 'next/server';

/** Hosts a browser may be on when it asks the API to change something. */
const OURS = new Set([
  'https://parea.photos',
  'https://www.parea.photos',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether a request may go on. Exported for the test, which has no server. */
export function allowedSource(request: {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
}): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'same-site' || site === 'none';

  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  // This deployment's own origin, whatever it is called — a preview URL, or a
  // domain added later — as well as the ones named above.
  return OURS.has(origin) || origin === new URL(request.url).origin;
}

export function proxy(request: NextRequest) {
  if (allowedSource(request)) return NextResponse.next();
  return NextResponse.json({ error: 'cross_site' }, { status: 403 });
}

export const config = {
  matcher: '/api/:path*',
};
