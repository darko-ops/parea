/**
 * How long a moment lasts, from when it was posted.
 *
 * Here rather than in the web app because two processes have to agree on it:
 * the web stops showing a moment at this age, and the deriver's clean-up
 * deletes it — the row and both objects — shortly after. A moment that
 * outlived its day in storage would be a promise the product did not keep.
 */
export const MOMENT_HOURS = 24;

/**
 * How long past `MOMENT_HOURS` the clean-up waits before deleting.
 *
 * Somebody who opened the viewer a minute before a moment expired is holding
 * an hour-long signed link to its picture; deleting the object under them
 * turns the last thing they were looking at into a broken image. An hour is
 * the length of that link.
 */
export const MOMENT_GRACE_HOURS = 1;

/**
 * The longest caption, in characters. A line or two under a photograph — the
 * picture is the moment, and the words are only there to say what it is.
 * Here because the server refuses past it and both clients stop typing at it.
 */
export const MOMENT_CAPTION_MAX = 200;

/**
 * A caption as stored: trimmed, runs of blank lines folded to one, and null
 * for nothing at all. `undefined` for one that is not a string or is too long,
 * which the route refuses rather than quietly cutting somebody's sentence.
 */
export function momentCaption(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return null;
  return text.length > MOMENT_CAPTION_MAX ? undefined : text;
}
