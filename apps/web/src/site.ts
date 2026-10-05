/**
 * The site's own origin.
 *
 * A constant rather than configuration, for the reason `deeplinks.ts` gives
 * about the bundle identifiers: it is not configurable. The app claims
 * `applinks:parea.photos` and `applinks:www.parea.photos` in `app.json`, and a
 * deployment serving a different canonical origin would be pointing every card
 * it produces at somewhere the app does not answer for.
 *
 * It is the layout's `metadataBase`, which is what turns every relative path
 * in the metadata into the absolute URL an unfurler needs. Without one Next
 * guesses from `VERCEL_URL` — the per-deployment hostname, which changes on
 * every push and is not the address anybody's link points at. The sitemap and
 * `robots.txt` name it too.
 *
 * `www`, not the apex. The apex answers 308 to `www`, so every absolute URL
 * built on it — the card's image, a canonical, the sitemap — sent a crawler
 * through a redirect to reach the page that actually answers, and told it the
 * site's address was one that never serves a page.
 */
export const SITE = 'https://www.parea.photos';
