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
