/**
 * Where the reader's clock is, as far as this request can tell.
 *
 * Two answers, in order of how much they are worth:
 *
 *   pa_tz                  what the browser resolved, written by `ReaderZone`
 *                          on the first page it renders. The only source that
 *                          knows the *device's* setting, which is the one the
 *                          reader thinks of as their time.
 *
 *   x-vercel-ip-timezone   the zone of the address the request arrived from,
 *                          attached by the edge. Wrong behind a VPN and wrong
 *                          for the day somebody lands somewhere, but right for
 *                          nearly everybody on the *first* request — before
 *                          any script has run and before there is a cookie to
 *                          read. That is the request that used to say good
 *                          afternoon over somebody's breakfast, so it is the
 *                          one that matters.
 *
 * Null when neither answers, and null means the server's own clock. In the
 * deployment that is UTC, which is a guess, and callers are written knowing
 * it is a guess.
 *
 * Not stored on the account. A zone on a record goes stale the first time
 * somebody flies and then stays wrong until they find a setting they have no
 * reason to look for; the browser is asked on every page instead, so it is
 * never out of date by more than one navigation.
 */

import { cookies, headers } from 'next/headers';

import { ZONE_COOKIE, isZone } from './zoneCookie';

export async function readerZone(): Promise<string | null> {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const told = jar.get(ZONE_COOKIE)?.value;
  if (isZone(told)) return told;
  const guessed = head.get('x-vercel-ip-timezone');
  return isZone(guessed) ? guessed : null;
}
