/**
 * How long a rate-limit counter has to live — shared by the limiter that
 * writes it (`apps/web/src/ratelimit.ts`) and the hourly job that sweeps it
 * (`expire-rate-limits` in the deriver).
 *
 * Most limits count per hour. A few count per day, and the sweep used to
 * delete every counter two hours after its window began — which reset the
 * day-long ones every couple of hours, so "five verification texts per
 * account per day" was really five every two or three. Those are named here
 * with their windows, so the sweep keeps each for as long as it counts. A test
 * in the web app fails if a limit longer than an hour is added without being
 * listed.
 */

/** The window every limit not listed below uses. */
export const RATE_LIMIT_DEFAULT_WINDOW_SECONDS = 3600;

/** Limits that count over more than an hour, by name, and their windows. */
export const RATE_LIMIT_LONG_WINDOWS: Readonly<Record<string, number>> = {
  'phone-account': 86_400,
  'phone-daily': 86_400,
};

/**
 * How long after its window began a counter may be deleted: its window plus
 * an hour, so a counter is never swept while it can still refuse somebody.
 */
export function rateLimitKeepSeconds(name: string): number {
  return (RATE_LIMIT_LONG_WINDOWS[name] ?? RATE_LIMIT_DEFAULT_WINDOW_SECONDS) + 3600;
}
