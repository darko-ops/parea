/**
 * Finding one of your own events by typing at it.
 *
 * Deliberately unlike the handle search in `friends.ts`, and the difference is
 * the point. That one walks the account table and is prefix-only, because a
 * substring match there is enumeration wearing a search box. This one runs
 * over a list the server has already decided this person may see — their own
 * events, already on the page — so it can match anywhere in the string without
 * disclosing anything. Nothing it can find was hidden.
 *
 * Over the name and the place together, which is what let "By place" go. That
 * was a second ordering of the whole list to answer "the Greece one", and a
 * list re-sorted alphabetically is a worse answer to that than typing "greece".
 *
 * The place is matched even though the card no longer prints it. That breaks
 * the usual rule — a query should match what somebody can see — and it is the
 * right trade here: the alternative is that the one thing By place existed for
 * stops working, silently, because a card was redesigned.
 */

/** What a query is matched against: everything about an event that is words. */
export function searchable(event: { name: string; place: string | null }): string {
  return `${event.name} ${event.place ?? ''}`.toLowerCase();
}

/**
 * Every term has to appear somewhere, in any order.
 *
 * Term-wise rather than as one string so that "roast anchor" finds the Sunday
 * roast at The Anchor — the two words someone remembers are rarely adjacent,
 * and rarely in the order they were written.
 *
 * An empty query matches everything, which is what makes this safe to call
 * unconditionally: the caller never has to decide whether it is searching.
 */
export function matches(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}
