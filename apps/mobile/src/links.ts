/**
 * Arriving from a link — docs/design.md §9.
 *
 * Someone taps a link in a group chat. If the app is installed, iOS and
 * Android hand it here instead of opening Safari; if it is not, the web client
 * answers and the person contributes anyway. That is the whole point of the
 * three doors, and this file is the one that has to work at the moment a
 * person is standing at a party with one hand free.
 *
 * Two shapes arrive, and they parse differently:
 *
 *   https://parea.photos/e/<token>   a verified Universal Link / App Link
 *   parea://e/<token>                the custom scheme
 *
 * In the second, `e` is the URL's *host* rather than a path segment — the
 * classic way a deep-link parser works on one platform and silently not the
 * other, because a custom-scheme URL has no authority to speak of and
 * whatever follows `//` becomes one.
 *
 * Deliberately free of React Native imports so it can be tested in node, which
 * matters more here than usual: the alternative is testing it by rebuilding an
 * app, reinstalling it, and tapping a link.
 */

import { tokenFromInput } from './api';

export type Arrival = { linkToken: string };

/**
 * What a URL means, or null if it means nothing we can act on.
 *
 * Null covers a real case rather than only malformed input: `/event/<id>`
 * works in a browser because the link was already exchanged for a capability
 * cookie, and carries nothing a native client can use. Neither platform will
 * route that path to us — the entitlement and the intent filter both claim
 * `/e` only — but the custom scheme has no such filter, so it is worth
 * answering rather than assuming.
 */
export function arrivalFromUrl(url: string): Arrival | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const httpish = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  const parts = [
    // For `parea://e/<token>` the host is really the first path segment. For
    // `https://parea.photos/e/<token>` it is the domain and belongs nowhere.
    ...(httpish ? [] : [parsed.host]),
    ...parsed.pathname.split('/'),
  ].filter(Boolean);

  if (parts[0] !== 'e' || !parts[1]) return null;

  // Same validation as a pasted link, so a hand-typed URL and a tapped one
  // cannot disagree about what counts as a token.
  const linkToken = tokenFromInput(parts[1]);
  return linkToken ? { linkToken } : null;
}
