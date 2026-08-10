/**
 * The auto-selection window a creator sends — design §7.3.
 *
 * `event.starts_at` / `ends_at` have been in the schema since the first
 * migration and no client set them until the native create screen existed, so
 * this is the first code that has had to decide what a bad window looks like.
 *
 * §17 states the asymmetry that makes it worth deciding carefully: *a wrong
 * window is worse than no window*. Nothing downstream can catch one —
 * `resolveWindow` resolves happily against a reversed or open interval, and
 * the only symptom is a contributor being shown forty pre-ticked photos from
 * the wrong day, which costs their trust and the photo-library permission at
 * the same moment.
 *
 * Separate from the route because it is the part with a decision in it, and
 * because a test of that decision should not have to stand up a request.
 */

export type EventWindow = { startsAt: Date; endsAt: Date };

/**
 * Both ends or neither, and forwards.
 *
 * Half a window is not a window: it would leave auto-selection resolving
 * against an open interval, which is every photo on the device. `'invalid'`
 * rather than quietly dropping it, because a client sending a malformed
 * window has a bug and should hear about it — silently storing no window
 * would look identical to a creator answering "not sure".
 */
export function parseWindow(
  rawStart: unknown,
  rawEnd: unknown,
): EventWindow | null | 'invalid' {
  const startsAt = asDate(rawStart);
  const endsAt = asDate(rawEnd);
  if (rawStart == null && rawEnd == null) return null;
  if (!startsAt || !endsAt) return 'invalid';
  if (endsAt.getTime() <= startsAt.getTime()) return 'invalid';
  return { startsAt, endsAt };
}

export function asDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD`, the shape the `date` column takes. */
export function asDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
