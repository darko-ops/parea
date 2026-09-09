/**
 * Photos handed from the page that picked them to the page that sends them.
 *
 * This module exists because of one sentence in the create page's own header:
 * *a `File` is lent to the tab that picked it, and a navigation ends the loan*.
 * That rule is why the two create steps are one page rather than two routes —
 * and then the last step broke it anyway, writing the handles to IndexedDB and
 * leaving with `location.href`. The handles arrived at the event page dead,
 * every item went `stale`, and nothing was ever presigned: an event created
 * with forty photos attached, holding none, having asked the server for
 * nothing.
 *
 * IndexedDB stores the `File` faithfully. What it cannot store is the loan.
 * A picked photo is a reference to bytes the OS is lending this document, and
 * on iOS — where the picker hands over a temp copy of a library asset — the
 * lending ends when the document does. Cloning the reference into a database
 * clones a reference to something that will not be there.
 *
 * So the handles are kept here, in memory, in the realm that owns them, and
 * the navigation to the event page is a client-side one that does not end the
 * loan. IndexedDB stays exactly what it was for — surviving a real reload,
 * where these bytes are genuinely gone and the answer is to ask for them
 * again.
 *
 * Not a cache: these are references to somebody's photographs, and holding
 * them after the page that wanted them has finished is a leak with a size. So
 * they are handed over and then dropped — but reading and dropping are two
 * calls, and that separation is the entire lesson of this module's first
 * version.
 *
 * ## Why `peek` and `release` are not one `claim`
 *
 * They were one call that emptied what it returned, which is wrong in exactly
 * the environment this gets tested in. Strict Mode — on by default under the
 * app router — runs an effect, tears it down, and runs it again. The first
 * run took the handles and the teardown marked its work cancelled; the second
 * run, the one whose result is actually used, found the shelf bare and fell
 * back to the database. On a desktop browser that fallback works and nothing
 * looks wrong, which is why this survived a green test run and a manual check
 * and went on failing on the phones it was written for.
 *
 * So a read is not a consumption. `release` is called by the run that got far
 * enough to keep what it built, and a run that was cancelled leaves the
 * handles for its replacement.
 */

/** Live handles, by event, keyed by the queue item id they belong to. */
const lent = new Map<string, Map<string, File>>();

/** Park live handles for the page about to open. */
export function lend(eventId: string, files: Map<string, File>): void {
  if (files.size === 0) return;
  lent.set(eventId, files);
}

/**
 * Look, without taking.
 *
 * Safe to call from a render that is about to be thrown away, which is the
 * point. Empty is the ordinary answer, not a failure: every arrival at an
 * event page that did not just create it comes through here first.
 */
export function peek(eventId: string): Map<string, File> {
  return lent.get(eventId) ?? new Map();
}

/** Done with them — called once the queue holding them is the real one. */
export function release(eventId: string): void {
  lent.delete(eventId);
}

/** Tests only — the map outlives a component, which is the whole point. */
export function __resetHandoff(): void {
  lent.clear();
}
