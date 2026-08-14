/**
 * Looking up a place while somebody types.
 *
 * A proxy, and it is a proxy for one reason: the key. A places API key in the
 * browser is a key anybody can lift and spend, and the usual mitigation —
 * restricting it to a referrer — is a header any script can send. It stays on
 * the server, one hop away, and the browser gets names.
 *
 * ## What comes back, and what is stored
 *
 * A label. `event.place` is a text column and stays one: no latitude, no
 * longitude, no place id. The product deliberately holds no coordinates for
 * anybody's evening — §7.6 strips GPS from every photo at ingest and the
 * ingest *fails* if any survives — and a lookup that wrote a pin into the row
 * would quietly reverse that decision for the sake of an autocomplete.
 *
 * So this makes the field easier to fill in and changes nothing about what the
 * album knows. "The Mayflower, Rotherhithe" is what a person would have typed;
 * it is just spelled correctly now.
 *
 * ## No key, no lookup
 *
 * `PLACES_TOKEN` unset answers an empty list, which is exactly what the field
 * does with it: the input is a plain text box that takes whatever is typed,
 * the same as before. That is the honest degraded state for a feature whose
 * credential belongs to whoever runs the deployment, and it is why nothing on
 * the create screen depends on a suggestion arriving.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Enough to choose from, few enough to read without scrolling. */
const LIMIT = 5;
/** Below this a query is a prefix, and a prefix matches the whole world. */
const MIN = 3;

export type Place = { label: string };

export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (query.length < MIN) return NextResponse.json({ places: [] });

  const token = process.env.PLACES_TOKEN;
  if (!token) return NextResponse.json({ places: [] });

  try {
    const places = await lookup(query, token);
    return NextResponse.json(
      { places },
      // A minute. Two people typing the same place while deciding what to call
      // an album is common, and the answer does not change.
      { headers: { 'cache-control': 'private, max-age=60' } },
    );
  } catch {
    // A lookup that fails is a field with no suggestions, which is a field.
    // Never an error in front of somebody who is naming a party.
    return NextResponse.json({ places: [] });
  }
}

/**
 * Mapbox's search endpoint, because it takes a plain GET and returns names.
 *
 * Swapping providers is this function: everything above it and the whole
 * client know only `{ label }`. `types` asks for the things people name a
 * night out after — a bar, a park, a neighbourhood, a town — rather than
 * street addresses, which is what the field is for.
 */
async function lookup(query: string, token: string): Promise<Place[]> {
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set('access_token', token);
  url.searchParams.set('limit', String(LIMIT));
  url.searchParams.set('types', 'poi,neighborhood,locality,place');
  if (process.env.PLACES_COUNTRY) {
    url.searchParams.set('country', process.env.PLACES_COUNTRY);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return [];

  const body = (await res.json()) as { features?: { place_name?: unknown }[] };
  return (body.features ?? [])
    .map((feature) => (typeof feature.place_name === 'string' ? feature.place_name : ''))
    .filter((label) => label.length > 0)
    // The column takes 80 characters and a full geocoder line can be longer
    // than that. Trimmed here so the suggestion is what gets stored, rather
    // than something that silently loses its tail on the way into the row.
    .map((label) => ({ label: label.slice(0, 80) }))
    .slice(0, LIMIT);
}
