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
  /*
   * Backwards is invalid. Instant is not.
   *
   * This refused `endsAt <= startsAt`, which reads as "a window has to have
   * some width" and turns out to refuse a real and ordinary album: one made
   * from a single photograph. The span of one picture starts and ends at the
   * moment it was taken, the client sends exactly that, and the whole
   * creation came back 400 — so an album of one photograph could not be made
   * at all, and neither could one whose photographs were all taken inside the
   * same second.
   *
   * What the check is for is corruption: a window that runs backwards would
   * be stored happily and then pre-select the wrong photographs for every
   * contributor. A window of no width does nothing of the kind. It offers
   * nothing extra to the next person, which is the honest answer when there
   * is one photograph to go on — and `resolveWindow` widens from what has
   * actually been uploaded once there is more than one.
   */
  if (endsAt.getTime() < startsAt.getTime()) return 'invalid';
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
