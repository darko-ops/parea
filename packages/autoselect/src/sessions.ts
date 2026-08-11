/**
 * Finding the event on the phone, instead of asking what it was.
 *
 * `when.ts` asks a creator to pick "Tonight" or "Last night" and turns that
 * into a window. It works, and it is the wrong shape. The window it produces is
 * a guess about the photos, when the photos are right there and know the
 * answer: a night out is a run of pictures with hours of nothing on either
 * side, and that run has exact edges that no phrase does. Asking also puts a
 * question in front of someone before the product has done anything for them,
 * and §17 already records that a careless answer here is worse than none.
 *
 * So: read the last few days, find the runs, and offer the most recent one as a
 * thing you tap. The window becomes a *result* rather than an input, and it is
 * accurate to the minute rather than to the nearest six hours.
 *
 * ## The same algorithm as the probe, deliberately
 *
 * `sessionise` below is a port of `sessionise` in tools/geotag-probe/analyze.py,
 * thresholds included, and `narrow` is that file's `assess`. That is the whole
 * point of the probe: it measures, against real camera rolls, how often this
 * finds a clean event. A port that drifted would make the measurement describe
 * software nobody is running. The shared fixture in this package's tests is
 * what stops it drifting.
 *
 * ## What this does not change
 *
 * Precision over recall still decides how much arrives ticked. Detecting a
 * session says *these photos were taken together*; it says nothing about
 * whether one of them is a screenshot of a bank balance. The location cluster
 * filter still runs, confidence still governs pre-selection, and a low-
 * confidence bundle still opens with nothing ticked. Finding the event more
 * accurately is not a reason to start guessing harder.
 */

import { narrow, type Candidate, type Suggestion, type Window } from './narrow';

/** A gap this long ends a session. Four hours: lunch is not last night. */
export const DEFAULT_GAP_HOURS = 4;

/**
 * Below this, a run is not an event.
 *
 * Eight is the probe's default and it is doing real work: two photos of a
 * parking bay and a receipt are a "run of photos with no long gap" and are not
 * a night out. Offering them costs more than missing a small event, because the
 * offer is the product's first impression of whether it understands anything.
 */
export const MIN_SESSION_PHOTOS = 8;

/** How far back to look. Beyond this, someone is not "adding last night". */
export const RECENT_DAYS = 3;

/**
 * Slack on each end of a detected window.
 *
 * The window outlives this screen — it is stored on the event and is what
 * *other people's* phones auto-select against later. Their evening started
 * before your first photo and ended after your last, so the edges of one
 * person's run are a slightly tight description of the event. An hour is the
 * same padding `resolveWindow` uses when inferring from uploads.
 */
export const SESSION_PAD_MS = 60 * 60 * 1000;

/** An evening runs into the next morning; 4am is where a night stops being one. */
const EVENING_START_HOUR = 18;
const NIGHT_END_HOUR = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A run of photos with no long gap — a candidate event already on the phone. */
export type Session = {
  /** Everything in the run, screenshots included; `narrow` drops those. */
  photos: Candidate[];
  /** First and last capture time in the run. */
  start: number;
  end: number;
};

/**
 * Split assets into runs separated by gaps.
 *
 * Port of the probe's `sessionise`. Undated assets are dropped rather than
 * sorted to the front: a photo with no capture time cannot be placed in a run,
 * and guessing puts it in the wrong one.
 */
export function sessionise(
  assets: Candidate[],
  options: { gapHours?: number; minSize?: number } = {},
): Session[] {
  const gapMs = (options.gapHours ?? DEFAULT_GAP_HOURS) * 60 * 60 * 1000;
  const minSize = options.minSize ?? MIN_SESSION_PHOTOS;

  const dated = assets
    .filter((a) => Number.isFinite(a.createdAt))
    .sort((a, b) => a.createdAt - b.createdAt);

  const runs: Candidate[][] = [];
  let current: Candidate[] = [];

  for (const asset of dated) {
    const previous = current[current.length - 1];
    if (previous && asset.createdAt - previous.createdAt > gapMs) {
      runs.push(current);
      current = [];
    }
    current.push(asset);
  }
  if (current.length > 0) runs.push(current);

  return runs
    // Counted on the photos a person would actually be offered. A run of nine
    // where six are screenshots is three photos wearing a trench coat.
    .filter((run) => run.filter((p) => !p.isScreenshot).length >= minSize)
    .map((run) => ({
      photos: run,
      start: run[0]!.createdAt,
      end: run[run.length - 1]!.createdAt,
    }));
}

/**
 * The day an event belongs to, which is not always the day it started.
 *
 * A session that begins at 00:40 belongs to the night before — nobody calls
 * that Saturday when it started at Friday's party. Anything before 4am is
 * filed under the previous day, the same boundary `when.ts` uses.
 */
export function eventDayFor(session: Session): Date {
  const start = new Date(session.start);
  const offset = start.getHours() < NIGHT_END_HOUR ? -1 : 0;
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + offset,
    12,
  );
}

/** Whole local days between two dates, ignoring the time of day. */
function daysApart(a: Date, b: Date): number {
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(b) - midnight(a)) / DAY_MS);
}

function clock(ms: number): string {
  const d = new Date(ms);
  const hours = d.getHours();
  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(d.getMinutes()).padStart(2, '0')}${suffix}`;
}

/**
 * What to call it, in the words someone would use.
 *
 * The same vocabulary the old picker offered — "Tonight", "Last night",
 * "Yesterday" — except it is now a statement about photos that exist rather
 * than a question. Past a week it becomes a date, because "Tuesday" three weeks
 * ago is not a useful thing to say to someone.
 */
export function labelFor(session: Session, now: Date = new Date()): string {
  const day = eventDayFor(session);
  const ago = daysApart(day, now);
  const startHour = new Date(session.start).getHours();
  const night = startHour >= EVENING_START_HOUR || startHour < NIGHT_END_HOUR;

  if (ago === 0) {
    if (night) return 'Tonight';
    return startHour < 12 ? 'This morning' : 'This afternoon';
  }
  if (ago === 1) return night ? 'Last night' : 'Yesterday';
  if (ago > 1 && ago < 7) {
    const weekday = WEEKDAYS[day.getDay()]!;
    return night ? `${weekday} night` : weekday;
  }
  return `${day.getDate()} ${MONTHS[day.getMonth()]}`;
}

/** `event_date`, in the same YYYY-MM-DD local form `eventDateFor` produces. */
export function eventDateOf(session: Session): string {
  const day = eventDayFor(session);
  return [
    day.getFullYear(),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');
}

/** A detected event, ready to be shown as one tappable thing. */
export type Bundle = {
  session: Session;
  /** Padded, and what gets stored on the event. */
  window: Window;
  /** The cluster filter's verdict — governs what arrives ticked. */
  suggestion: Suggestion;
  /** "Last night", "Saturday night", "12 August". */
  label: string;
  /** "8:14pm – 1:40am". */
  timeRange: string;
  /** YYYY-MM-DD, local. */
  eventDate: string;
  /**
   * What the card should say, and honestly.
   *
   * The count of what would actually be ticked when confident, and of what
   * the grid will show when not. Showing the cluster count on a low-confidence
   * bundle would promise a selection that is deliberately not going to happen.
   */
  count: number;
  /** First photo of the run, for the card's thumbnail. */
  coverId: string;
};

function bundle(session: Session, now: Date, radiusM?: number): Bundle {
  const window: Window = {
    start: session.start - SESSION_PAD_MS,
    end: session.end + SESSION_PAD_MS,
  };
  const suggestion = narrow(session.photos, window, radiusM);
  const count =
    suggestion.confidence === 'high'
      ? suggestion.preselected.length
      : suggestion.candidates.length;

  return {
    session,
    window,
    suggestion,
    label: labelFor(session, now),
    timeRange: `${clock(session.start)} – ${clock(session.end)}`,
    eventDate: eventDateOf(session),
    count,
    coverId: (suggestion.candidates[0] ?? session.photos[0]!).id,
  };
}

/**
 * Recent events found on the phone, newest first.
 *
 * Returns a list rather than one, because the most recent run is not always the
 * one someone opened the app for — the answer is often "last night" and
 * sometimes "the wedding on Saturday", and two cards cost nothing while a wrong
 * single guess costs a trip through the system picker.
 */
export function recentBundles(
  assets: Candidate[],
  options: {
    now?: Date;
    gapHours?: number;
    minSize?: number;
    recentDays?: number;
    radiusM?: number;
    limit?: number;
  } = {},
): Bundle[] {
  const now = options.now ?? new Date();
  const horizon = now.getTime() - (options.recentDays ?? RECENT_DAYS) * DAY_MS;

  return sessionise(assets, options)
    .filter((s) => s.end >= horizon)
    // Newest first: "what did I just do" is the question being answered.
    .sort((a, b) => b.end - a.end)
    .slice(0, options.limit ?? 3)
    .map((s) => bundle(s, now, options.radiusM));
}
