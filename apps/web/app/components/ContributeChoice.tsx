'use client';

/**
 * Who can add photographs — three answers, in the two places it is asked.
 *
 * The companion to `AccessChoice`, and deliberately shaped like it: the same
 * pills, the same one-line help under them, the same copy living in one place
 * and reaching both the create screen and the manage screen.
 *
 * It replaces a switch called "People can still add photos", which was on or
 * off. Two of the three answers below were the same value in that switch — on
 * meant "whoever the album is open to" — and the third could not be said at
 * all. An evening where one person had the camera and everybody else came to
 * look is an ordinary thing to want, and the album had to be either open to
 * all of them or closed to everyone including the person holding the camera.
 *
 * ## The copy says what happens, not what the setting is called
 *
 * Same rule `AccessChoice` follows. "Everyone who can see it" is a fact
 * somebody can predict from; `uploads_open` was a switch they had to
 * interpret. And the first option deliberately points back at the other
 * setting rather than restating it — the two compose, and an album's answer to
 * "who can see it" is what decides who "everyone" is.
 */

import { CONTRIBUTE_EVERYONE, CONTRIBUTE_HOST, CONTRIBUTE_NOBODY } from '@parea/core';

export type ContributePolicy =
  | typeof CONTRIBUTE_EVERYONE
  | typeof CONTRIBUTE_HOST
  | typeof CONTRIBUTE_NOBODY;

export const CONTRIBUTE_OPTIONS: {
  value: ContributePolicy;
  label: string;
  /** What happens to somebody looking at the album. */
  help: string;
}[] = [
  {
    value: CONTRIBUTE_EVERYONE,
    label: 'Everyone',
    help: 'Anyone who can see the album can add to it. On a private album that is the people in it; on a public one it is whoever has the link. Adding always needs an account, so every photograph says who put it there.',
  },
  {
    value: CONTRIBUTE_HOST,
    label: 'Only me',
    help: 'You add the photographs and everybody else comes to look. They can still say something and react — it is the pictures that are yours to put in.',
  },
  {
    value: CONTRIBUTE_NOBODY,
    label: 'Nobody',
    help: 'The album is finished. Nothing more goes in, including from you — change this back and it opens again. The conversation stays open either way.',
  },
];

export function ContributeChoice({
  value,
  onChange,
  disabled = false,
  /** Shown under the options when this is an album that already exists. */
  note,
}: {
  value: ContributePolicy;
  onChange: (next: ContributePolicy) => void;
  disabled?: boolean;
  note?: string;
}) {
  const chosen = CONTRIBUTE_OPTIONS.find((option) => option.value === value);

  return (
    <>
      <div className="pills">
        {CONTRIBUTE_OPTIONS.map((option) => (
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
