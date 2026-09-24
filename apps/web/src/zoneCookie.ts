/**
 * The cookie the reader's time zone travels in, and what counts as one.
 *
 * Split out from `zone.ts` for a boring reason with teeth: the browser writes
 * this cookie and the server reads it, so the name exists on both sides of the
 * boundary, and `zone.ts` imports `next/headers` — which a client component
 * cannot import at all. Without this file the name would be a string literal
 * in `ReaderZone` and a constant on the server, and a rename would take one of
 * them. What that looks like in use is not an error: it is a greeting that is
 * quietly wrong again, for the reason it was wrong the first time.
 */

export const ZONE_COOKIE = 'pa_tz';

/** A year. Long enough to outlive a session, short enough to lapse if unused. */
export const ZONE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Whether `Intl` will accept it as a zone.
 *
 * The value arrives from a cookie and from a header, which is to say from the
 * request — `Intl.DateTimeFormat` throws a RangeError on anything it does not
 * recognise, and an unhandled throw in a layout is a blank page. Asking `Intl`
 * directly is also the only check that stays correct as the zone database
 * changes; a regex for `Region/City` would pass `Foo/Bar` and fail `UTC`.
 */
export function isZone(value: string | null | undefined): value is string {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
