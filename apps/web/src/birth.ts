/**
 * Is somebody old enough to make an account — asked as little as possible.
 *
 * Sign-up asks the year someone was born, and nothing else unless the year
 * cannot settle it. Born fourteen or more years ago: 13 or older, whatever the
 * month. Twelve or fewer: under 13. Exactly thirteen years ago is the one year
 * that could go either way, so only then is the month asked — and only if that
 * month is this month, the day.
 *
 * Neutral on purpose. The screen asks "what year were you born?", never "are
 * you 13 or older?", because a question that names its own cutoff tells a child
 * the answer to give (the FTC's guidance on age screens under COPPA). Nothing
 * asked here is stored: only that the check passed.
 *
 * No imports, so the web client, the server and — as an identical copy in
 * `apps/mobile/src/birth.ts`, checked by a test — the app all apply the same
 * rule. Dates are compared in UTC on every side so that they agree on what to
 * ask.
 */

export const MINIMUM_AGE = 13;

export type BirthCheck =
  | { ok: true }
  | { ok: false; reason: 'too_young' | 'invalid' | 'need_month' | 'need_day' };

/**
 * `"2009"`, `"2013-06"` or `"2013-06-21"` — as much of a birth date as has been
 * given — checked against `now`.
 */
export function checkBirth(birth: unknown, now = new Date()): BirthCheck {
  if (typeof birth !== 'string') return { ok: false, reason: 'invalid' };
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(birth.trim());
  if (!match) return { ok: false, reason: 'invalid' };
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);

  const thisYear = now.getUTCFullYear();
  const thisMonth = now.getUTCMonth() + 1;
  const today = now.getUTCDate();

  if (year > thisYear || year < thisYear - 130) return { ok: false, reason: 'invalid' };
  if (month !== null && (month < 1 || month > 12)) return { ok: false, reason: 'invalid' };
  if (month !== null && day !== null) {
    const born = new Date(Date.UTC(year, month - 1, day));
    // A date that rolled over — 31 February — is not a date anybody was born on.
    if (born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return { ok: false, reason: 'invalid' };
    if (born.getTime() > now.getTime()) return { ok: false, reason: 'invalid' };
  }

  const years = thisYear - year;
  if (years > MINIMUM_AGE) return { ok: true };
  if (years < MINIMUM_AGE) return { ok: false, reason: 'too_young' };

  // Born exactly 13 years ago: old enough once this year's birthday has come.
  if (month === null) return { ok: false, reason: 'need_month' };
  if (month < thisMonth) return { ok: true };
  if (month > thisMonth) return { ok: false, reason: 'too_young' };
  if (day === null) return { ok: false, reason: 'need_day' };
  return day <= today ? { ok: true } : { ok: false, reason: 'too_young' };
}

/** Which of month and day the screen has to show for what has been typed so far. */
export function birthFieldsNeeded(year: string, month: string, now = new Date()): { month: boolean; day: boolean } {
  if (!/^\d{4}$/.test(year)) return { month: false, day: false };
  const byYear = checkBirth(year, now);
  if (byYear.ok || byYear.reason !== 'need_month') return { month: false, day: false };
  const byMonth = /^\d{1,2}$/.test(month) ? checkBirth(`${year}-${month}`, now) : null;
  return { month: true, day: !!byMonth && !byMonth.ok && byMonth.reason === 'need_day' };
}

/** What to send for what has been typed, or `''` while something needed is missing. */
export function birthValue(year: string, month: string, day: string, now = new Date()): string {
  if (!/^\d{4}$/.test(year)) return '';
  const need = birthFieldsNeeded(year, month, now);
  if (need.month && !/^\d{1,2}$/.test(month)) return '';
  if (need.day && !/^\d{1,2}$/.test(day)) return '';
  return [year, need.month ? month.padStart(2, '0') : null, need.day ? day.padStart(2, '0') : null]
    .filter(Boolean)
    .join('-');
}
