'use client';

/**
 * Who can see it — two answers, in the two places it is asked.
 *
 * It is asked when an album is made and again when one is managed, and there
 * used to be three answers: anyone with the link, private-but-the-link-admits,
 * and private-and-I-approve. The middle one is gone. It was the setting that
 * made "private" ambiguous — two albums both marked private behaved
 * differently on a forwarded link, and which way depended on a switch most
 * people never opened.
 *
 * So: public means anyone can see it. Private means you are in it or you are
 * not, and getting in is somebody adding you or the creator letting you in
 * after you ask. There is no third thing a link can do.
 *
 * The copy is the interesting part and it lives here, once. Each option says
 * what happens to the person on the other end, not what the policy is called:
 * "they ask, and you let them in" is a fact somebody can predict from, where
 * "account required" was a setting they had to interpret.
 */

import { PRIVATE, PUBLIC } from '@parea/core';

export type AccessPolicy = typeof PUBLIC | typeof PRIVATE;

export const ACCESS_OPTIONS: {
  value: AccessPolicy;
  label: string;
  /** What happens to somebody you send the link to. */
  help: string;
}[] = [
  {
    value: PUBLIC,
    label: 'Public',
    help: 'Anyone can see it — whoever holds the link, and anyone they pass it on to. No account needed to look; adding photos always needs one.',
  },
  {
    value: PRIVATE,
    label: 'Private',
    help: 'Only the people in it. You add them, or they ask and you let them in — from the link, or from your profile, where the album is listed by name with nothing in it showing. A forwarded link opens nothing.',
  },
];

/**
 * The same two, asked as a switch rather than as a row of names.
 *
 * The create screen asks it this way because somebody making an album is
 * deciding several things at once — who can see it, whether the link admits,
 * whether there is a phrase — and a line of switches is how that reads. Manage
 * asks it as two names because by then it is one settled fact being changed.
 *
 * Both end up in the same column, through this function and nowhere else.
 */
export function policyFor({ isPrivate }: { isPrivate: boolean }): AccessPolicy {
  return isPrivate ? PRIVATE : PUBLIC;
}

export function AccessChoice({
  value,
  onChange,
  disabled = false,
  /** Shown under the options when this is an album that already exists. */
  note,
}: {
  value: AccessPolicy;
  onChange: (next: AccessPolicy) => void;
  disabled?: boolean;
  note?: string;
}) {
  const chosen = ACCESS_OPTIONS.find((option) => option.value === value);

  return (
    <>
      <div className="pills">
        {ACCESS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="pill"
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="field-help">{chosen?.help}</p>
      {note && <p className="field-help">{note}</p>}
    </>
  );
}
