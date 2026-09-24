'use client';

/**
 * Telling the server what time it is where you are.
 *
 * The greeting is worded on the server, because a greeting worded in the
 * browser is a line of text that changes after the page has already drawn.
 * So the server has to be told the reader's zone, and the browser is the only
 * thing that actually knows it: this writes it into a cookie, once, and every
 * request after this one carries it. `zone.ts` is what reads it, and what it
 * falls back to until this has run.
 *
 * Renders nothing, and is mounted by `Shell` rather than by the pages that
 * greet — so the cookie is set by whatever page somebody happens to arrive on,
 * which is usually an event link and has no greeting on it at all. Arriving
 * there first is what makes the greeting right the first time they see one.
 *
 * ## The refresh
 *
 * On a first request there is no cookie and the edge's guess is all there is;
 * behind a VPN, or on the day somebody lands somewhere, that guess is wrong
 * and the page has already been rendered from it. `served` is the time of day
 * the server actually used, so the comparison here is between the *words* — a
 * zone that differs without changing them, which for most of the day it does,
 * rebuilds nothing. A page that refetches itself on everyone's first load to
 * correct nothing is a cost paid by everybody for a case that is nearly
 * nobody.
 *
 * Null `served` means the page under it never said a time of day, which is
 * most of them: write the cookie, refresh nothing. It is also what keeps the
 * legal pages static — nothing on this path reads the request on the server.
 *
 * Refuses to refresh unless the cookie is readable afterwards, and at most
 * once in any case. Both guards are the same failure: a browser that will not
 * store the cookie would otherwise be served the same wrong greeting forever,
 * refreshing forever to fix it.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { partOfDay, type PartOfDay } from '@/greeting';
import { ZONE_COOKIE, ZONE_COOKIE_MAX_AGE } from '@/zoneCookie';

/** Module scope, so one refresh survives this being mounted again. */
let refreshed = false;

export function ReaderZone({ served }: { served: PartOfDay | null }) {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;

    const written = `${ZONE_COOKIE}=${encodeURIComponent(zone)}`;
    document.cookie = `${written}; path=/; max-age=${ZONE_COOKIE_MAX_AGE}; samesite=lax`;

    if (!served || refreshed) return;
    if (!document.cookie.split('; ').includes(written)) return;
    if (partOfDay(new Date(), zone) === served) return;
    refreshed = true;
    router.refresh();
  }, [router, served]);

  return null;
}
