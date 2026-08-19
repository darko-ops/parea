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

/**
 * One column of a card's mosaic: how wide, and which photos are stacked in it.
 *
 * Indices rather than photos, because the two clients hold different things —
 * signed URLs on the web, the same strings behind a React Native `Image` on
 * the phone — and this function has no business knowing which.
 */
/**
 * The evening an album is about, as "Fri 14 Mar".
 *
 * Shared because two clients format it: the web signs its cards on the server,
 * and the profile page builds them in the browser from `/api/events`. Two
 * copies of a date format is two ways for the same album to be dated on two
 * screens of one product.
 *
 * The year is left off deliberately — these are recent evenings, and "Fri 14
 * Mar 2026" on a card is a filing reference. UTC because the album's own date
 * is a day, not a moment: rendering it in the reader's zone is how a Saturday
 * night becomes Sunday for somebody reading in Auckland.
 */
export function albumDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * How many faces a card draws before it starts counting.
 *
 * Three, and then a chip saying how many more. Four circles is the most a
 * 290px card carries without the row becoming a crowd, and a crowd is what the
 * number is for. Shared because the query that fetches them and the components
 * that draw them have to agree, and they live on opposite sides of the wire.
 */
export const CARD_FACES = 3;

/** An hour: the width of the claim "being added to now" makes. */
export const LIVE_MS = 60 * 60 * 1000;

/**
 * Whether an album is being added to right now.
 *
 * An hour rather than a day, because the badge says *now*: it is false about
 * something that stopped forty minutes ago in a way that "today" would not be.
 */
export function isLive(lastActiveAt: string, now: Date): boolean {
  return now.getTime() - new Date(lastActiveAt).getTime() < LIVE_MS;
}

export type MosaicColumn = { weight: number; photos: number[] };

/**
 * The tile arrangement, by how many photos there are.
 *
 * One hero plus a stacked pair, and nothing else. Earlier this was a
 * three-column shape at four photos; the brand-forward card simplifies it to
 * two, which reads as one photograph with company rather than a contact sheet.
 * Keyed on the count so two photos is a deliberate two-tile layout and not a
 * four-tile layout with holes in it — missing tiles fall back rather than
 * stretch.
 *
 * It lives here because it lived in two places before: `EventCard.tsx` and
 * `apps/mobile/src/Events.tsx` each had a hand-maintained copy with a comment
 * on each saying the other one had to agree with it. Two copies and a comment
 * is not a mechanism. Both clients now map this to their own layout primitive
 * — grid track weights on the web, `flex` on the phone — and there is one
 * decision about what a card looks like rather than two that must be kept in
 * step by hand.
 */
export function mosaicLayout(count: number): MosaicColumn[] {
  switch (Math.max(0, Math.min(4, count))) {
    case 0:
      return [];
    case 1:
      return [{ weight: 1, photos: [0] }];
    case 2:
      return [
        { weight: 1, photos: [0] },
        { weight: 1, photos: [1] },
      ];
    // Three and four draw the same shape: a hero and a stacked pair. The
    // fourth photo is not shown — it is fetched because `MOSAIC_TILES` is the
    // budget for every layout this has had, and a card that changes shape
    // depending on whether a fourth photo happens to exist is worse than one
    // spare thumbnail in a query that was already running.
    default:
      return [
        { weight: 2, photos: [0] },
        { weight: 1, photos: [1, 2] },
      ];
  }
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
