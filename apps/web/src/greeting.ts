/**
 * "Evening, Nadia" — the time of day, on the reader's clock.
 *
 * Worded on the server for the reason every relative time in this product is:
 * the two clocks disagree, and React discards a tree whose text does not match
 * the HTML it is hydrating. Which used to mean the greeting was the *server's*
 * time of day — UTC, in the deployment — and it told somebody good afternoon
 * over their breakfast. The comment here said a greeting was allowed to be
 * wrong in that way. It is not: a greeting is the one line on the page whose
 * entire content is a claim about the reader, and getting it wrong is the
 * product saying, first thing, that it has no idea where you are.
 *
 * So the hour is read in a zone that is passed in — see `zone.ts` for where
 * one comes from — and the rendering stays on the server, which is what keeps
 * the page from flickering. A null zone is the server's own clock: the old
 * behaviour, still the fallback, never the plan.
 *
 * Its own module because two pages open with it now. Home always did; Activity
 * joined when it stopped being a page called "Activity" with a list under it
 * and became one that says hello and then tells you what has been going on.
 * Two copies of a rule about somebody's name is one copy too many.
 */

export type PartOfDay = 'Morning' | 'Afternoon' | 'Evening';

/**
 * The hour 0–23, as it reads on a clock in `zone`.
 *
 * `formatToParts` rather than `format` because the string form of an hour is
 * not reliably a number: a locale can pad it, append a marker, or — with
 * `hour12: false` — answer "24" at midnight, which the boundaries below would
 * read as the evening of the day before. The part is the digits and nothing
 * else.
 *
 * An unusable zone falls back to the server's clock rather than throwing. This
 * is a greeting: the failure mode is being a few hours out, not a 500 on the
 * page somebody opened.
 */
export function hourIn(now: Date, zone: string | null): number {
  if (!zone) return now.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : now.getHours();
  } catch {
    return now.getHours();
  }
}

/**
 * Which of the three it is. Exported because the client has to decide whether
 * the server got it right, and it has to decide that by the same boundaries —
 * two copies of "afternoon starts at twelve" is one copy too many, and the
 * disagreement would show up as a page that refreshes itself for no visible
 * reason at six in the evening.
 */
export function partOfDay(now: Date, zone: string | null): PartOfDay {
  const hour = hourIn(now, zone);
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
}

export function greetingFor(
  name: string | null,
  now: Date,
  zone: string | null = null,
): string | null {
  // No greeting rather than "Evening, there". A greeting with a placeholder
  // where the name goes is worse than no greeting: it is the product noticing
  // it does not know who you are, out loud, at the top of the page.
  if (!name?.trim()) return null;
  return `${partOfDay(now, zone)}, ${name.trim().split(/\s+/)[0]}`;
}
