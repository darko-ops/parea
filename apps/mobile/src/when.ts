/**
 * "When was this?" — design §7.3, and the input auto-selection runs on.
 *
 * `event.starts_at` / `ends_at` have existed in the schema since the first
 * migration and no client has ever set them. The web create form sends only a
 * date. So the window that §7.3 says is "captured at creation, because
 * inferring it from uploads only helps contributor five, not contributor one"
 * has in fact always been inferred from uploads, and contributor one — the
 * person with 200 photos — has always fallen through to the system picker.
 * This is the first place it gets asked.
 *
 * ## Why presets and not a time picker
 *
 * §17 records the constraint: *the failure is asymmetric — a wrong window is
 * worse than no window.* A wrong window pre-ticks the wrong photos, which
 * spends the contributor's trust and the photo-library permission in the same
 * moment, and neither is recoverable. So the design goal is not "capture a
 * window", it is "capture a window that is right, or none".
 *
 * Two spinners and a duration field would get a careless answer, because
 * someone creating an event is standing at the thing they are creating it for.
 * A short list of phrases matching when people actually create events — during
 * it, or the morning after — gets a considered one, and "not sure" stays a
 * real answer rather than a punishment.
 *
 * Nothing is pre-selected. A default here is a guess wearing the clothes of an
 * answer.
 *
 * ## Local time, deliberately
 *
 * A party is a local-time thing: "Saturday 8pm" means 8pm where you are. The
 * boundaries are built from local date components, so the stored instants are
 * correct for the device that set them. A window spanning a DST transition is
 * an hour out at one end; the alternative is asking people what UTC is.
 */

export type WindowId = 'tonight' | 'last-night' | 'today' | 'yesterday' | 'unsure';

export type WhenOption = {
  id: WindowId;
  label: string;
  /** What it actually means, shown under the label — 8pm to 4am is not obvious. */
  hint: string;
};

/**
 * Ordered by what someone creating an event is most likely to be doing:
 * standing in the middle of it, or clearing up the next morning.
 */
export const WHEN_OPTIONS: WhenOption[] = [
  { id: 'tonight', label: 'Tonight', hint: 'this evening until the early hours' },
  { id: 'last-night', label: 'Last night', hint: 'yesterday evening until this morning' },
  { id: 'today', label: 'Today', hint: 'all day' },
  { id: 'yesterday', label: 'Yesterday', hint: 'all day' },
  { id: 'unsure', label: 'Not sure yet', hint: 'people pick their own photos' },
];

export type EventWindow = { startsAt: string; endsAt: string };

/** An evening runs into the next morning; 4am is where a night stops being one. */
const EVENING_START_HOUR = 18;
const NIGHT_END_HOUR = 4;

function at(base: Date, dayOffset: number, hour: number, minute = 0, second = 0): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    hour,
    minute,
    second,
    0,
  );
}

/**
 * The window a choice means, or null for "not sure".
 *
 * Null is a first-class answer, not a failure to answer: with no window the
 * app opens the system picker and nothing is pre-selected, which §7.3 calls a
 * good outcome. Returning a guess here instead would be the bad one.
 */
export function windowFor(choice: WindowId, now: Date = new Date()): EventWindow | null {
  const span = (from: Date, to: Date): EventWindow => ({
    startsAt: from.toISOString(),
    endsAt: to.toISOString(),
  });

  switch (choice) {
    case 'tonight':
      return span(at(now, 0, EVENING_START_HOUR), at(now, 1, NIGHT_END_HOUR));
    case 'last-night':
      return span(at(now, -1, EVENING_START_HOUR), at(now, 0, NIGHT_END_HOUR));
    case 'today':
      return span(at(now, 0, 0), at(now, 0, 23, 59, 59));
    case 'yesterday':
      return span(at(now, -1, 0), at(now, -1, 23, 59, 59));
    case 'unsure':
      return null;
  }
}

/**
 * The calendar date to file the event under, which is not the same question.
 *
 * `event_date` is what a human calls the day it happened; the window is the
 * hours photos came from. For a party running past midnight those disagree,
 * and the date people mean is the one it started on.
 */
export function eventDateFor(choice: WindowId, now: Date = new Date()): string | null {
  const day = choice === 'last-night' || choice === 'yesterday' ? -1 : 0;
  if (choice === 'unsure') return null;
  const date = at(now, day, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}
