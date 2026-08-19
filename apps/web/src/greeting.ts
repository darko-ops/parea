/**
 * "Evening, Nadia" — the time of day, on the server's clock.
 *
 * Worded on the server for the reason every relative time in this product is:
 * the two clocks disagree, and React discards a tree whose text does not match
 * the HTML it is hydrating. The server's zone is not the reader's, which makes
 * this occasionally wrong by a few hours for somebody travelling — a greeting
 * is allowed to be wrong in that way, and a page that flickered on every load
 * is not.
 *
 * Its own module because two pages open with it now. Home always did; Activity
 * joined when it stopped being a page called "Activity" with a list under it
 * and became one that says hello and then tells you what has been going on.
 * Two copies of a rule about somebody's name is one copy too many.
 */
export function greetingFor(name: string | null, now: Date): string | null {
  // No greeting rather than "Evening, there". A greeting with a placeholder
  // where the name goes is worse than no greeting: it is the product noticing
  // it does not know who you are, out loud, at the top of the page.
  if (!name?.trim()) return null;
  const hour = now.getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return `${part}, ${name.trim().split(/\s+/)[0]}`;
}
