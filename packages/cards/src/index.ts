/**
 * What an event card says about itself — shared by both clients.
 *
 * Two small functions that would otherwise exist twice. The repo has been
 * bitten enough times by a hand-maintained thing having a second copy
 * somewhere: `@parea/upload` was promoted out of the mobile client for this
 * reason, and `when.ts` lives beside the code that consumes it so the two
 * clients cannot come to disagree about what "Tonight" means. A relative time
 * that rounds differently on web and native is the same class of bug, quieter.
 *
 * Computed on the client rather than returned by the API on purpose: "20m ago"
 * has to become "2h ago" on a screen someone left open, and a string baked by
 * the server is wrong from the moment it is sent.
 *
 * No dependencies, no platform assumptions. The mobile client cannot take
 * `@parea/core` — that would pull the schema and drizzle into a React Native
 * bundle — so this is deliberately its own small thing.
 */

/**
 * How long ago, in the shortest form that is still true.
 *
 * Rounded down. "an hour ago" describing something 35 minutes old invites
 * someone to think they missed more than they did, and on a card whose whole
 * job is "is anything happening here", that matters more than precision.
 */
export function ago(from: Date, now: Date): string {
  // Clamped at zero because `from` comes from the server and `now` from the
  // device, and those clocks disagree. "-3m ago" is worse than a small lie.
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;

  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

export type CardMeta = {
  memberCount: number;
  place: string | null;
  /** ISO. */
  lastActiveAt: string;
};

/**
 * The line under the name: who, then where or when.
 *
 * The photo count is deliberately absent — it is already the large number on
 * the right of the same row, and saying it twice in one card is the kind of
 * duplication that makes a design feel like a form.
 *
 * The newest event shows recency instead of place, because at the top of the
 * list "added to 20m ago" is the fact that makes someone open it. Everything
 * below shows place where it has one, since by then *where* tells events apart
 * better than *when*.
 */
export function metaFor(
  event: CardMeta,
  options: { newest: boolean; now: Date },
): string {
  const people = `${event.memberCount} ${event.memberCount === 1 ? 'person' : 'people'}`;
  const recency = `added to ${ago(new Date(event.lastActiveAt), options.now)}`;
  const second = options.newest ? recency : (event.place ?? recency);
  return `${people} · ${second}`;
}
