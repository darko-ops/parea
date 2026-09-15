/**
 * Putting a time into words, once, on the server.
 *
 * Both of these lived in `app/activity/page.tsx`, which was the right place
 * while that page was the only thing that needed them. It is not any more: the
 * phone shows the same feed, and a second implementation of "is this today?"
 * is a second answer to a question that has to have one.
 *
 * ## Why the server words them at all
 *
 * For the web it is hydration: a boundary worked out in the browser can
 * disagree with the one the HTML was rendered against — a page loaded at 23:59
 * and hydrated at 00:00 finds its "Today" heading has become "Yesterday", and
 * React throws the tree away.
 *
 * For the phone the reason is different and better. A device's clock is a
 * setting, and a phone in the wrong timezone — or simply wrong — would draw a
 * feed whose headings disagree with the one the same person saw in a browser
 * ten minutes earlier. The rows come from one clock, so they are read the same
 * way everywhere.
 *
 * The cost is that a list held open past midnight keeps yesterday's words until
 * it is fetched again. That is the right trade for a page people open, read and
 * leave.
 */

const AGO = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Rough on purpose: nobody needs "3 hours and 12 minutes ago" for this. */
export function ago(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 3600
      ? ['minute', 60]
      : Math.abs(seconds) < 86_400
        ? ['hour', 3600]
        : ['day', 86_400];
  return AGO.format(Math.round(seconds / size), unit);
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long' });

/**
 * Which day-heading a line belongs under.
 *
 * Computed in the same pass that rounds the relative time, and for the same
 * reason as that one.
 *
 * Calendar days rather than 24-hour windows. "Yesterday" means the day before
 * this one, not "between 24 and 48 hours ago" — something at 9am today and
 * something at 11pm last night are fourteen hours apart and belong under
 * different words, which is the whole point of the headings.
 *
 * The tail is deliberately coarse. Month names for the rest of this year, then
 * one "Earlier" for everything before it: a feed bounded at fifty lines rarely
 * reaches back that far, and a heading per month for four years of history is
 * structure describing an archive this page is not.
 */
export function bucketFor(iso: string, now: Date): string {
  const at = new Date(iso);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round(
    (midnight(now).getTime() - midnight(at).getTime()) / 86_400_000,
  );

  // Negative is a clock somewhere being ahead — a photograph uploaded with a
  // future timestamp, or the two machines disagreeing by a minute across
  // midnight. It is still the newest thing on the page, so it goes at the top
  // under the heading everything else at the top has.
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (at.getFullYear() === now.getFullYear()) return MONTH.format(at);
  return 'Earlier';
}
