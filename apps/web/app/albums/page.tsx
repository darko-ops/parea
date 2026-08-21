/**
 * The old home path, still serving the home page. Not a redirect — see below.
 *
 * The route was `/events`, became `/albums` on 14 Aug behind a permanent 308,
 * and is `/events` again now that the interface calls these events. The obvious
 * tidy-up is `/albums → /events` and delete this file, and it is exactly the
 * thing that must not happen yet.
 *
 * A 308 has no expiry. Every browser that visited `/events` during those six
 * days recorded "this is permanently `/albums`" and will act on it without
 * asking us again. Redirecting `/albums` back to `/events` closes that into a
 * loop no request escapes: the browser resolves `/events` to `/albums` from its
 * own cache, we send it to `/events`, and round it goes. Serving the page here
 * ends the journey instead — one extra hop, then their home screen.
 *
 * Deleting this is safe once no live browser can still be holding the August
 * 308. Until then it costs a re-export.
 *
 * It inherits `/events`'s own metadata, which is `noindex` — this lists what
 * one person is in, and two paths to it is not two things to find.
 */

export { default, metadata } from '../events/page';

/*
 * Declared, not re-exported. Next parses the route-segment config statically
 * and refuses `export { dynamic } from …` outright — the value has to be
 * readable without running anything. It must match `/events`, which sets it for
 * the reason every page listing one person's things does: this is per-request.
 */
export const dynamic = 'force-dynamic';
