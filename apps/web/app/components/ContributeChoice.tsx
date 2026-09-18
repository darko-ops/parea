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

import {
  CONTRIBUTE_CREATOR,
  CONTRIBUTE_EVERYONE,
  CONTRIBUTE_HOST,
  CONTRIBUTE_NOBODY,
  PRIVATE,
} from '@parea/core';

export type ContributePolicy =
  | typeof CONTRIBUTE_EVERYONE
  | typeof CONTRIBUTE_CREATOR
  | typeof CONTRIBUTE_HOST
  | typeof CONTRIBUTE_NOBODY;

export type ContributeOption = {
  value: ContributePolicy;
  label: string;
  /** What happens to somebody looking at the album. */
  help: string;
};

/**
 * The three, in the order they are offered, per answer to "who can see it".
 *
 * Two lists rather than one with a relabelling pass, because the *order*
 * differs as well as the words and the order is the argument. On a public
 * album the ordinary answer is that everyone who turns up can add, so that
 * leads; on a private one the album is usually somebody's and the people in it
 * are the exception, so "Only me" leads. A single list would put the same
 * option first in both places and make one of them read as the default when it
 * is not.
 *
 * `everyone` is the same stored value under both labels. It has always
 * deferred to the other setting rather than restating it — "whoever the album
 * is open to" — and what changes is which word is true here: on a private
 * album the people who can see it are its members, and calling them "everyone"
 * was the one place this copy made somebody work out the composition for
 * themselves.
 *
 * `nobody` is on neither list. See `CONTRIBUTE_NOBODY`.
 */
const PUBLIC_OPTIONS: ContributeOption[] = [
  {
    value: CONTRIBUTE_EVERYONE,
    label: 'Everyone',
    help: 'Anybody who opens the link can add to it. Adding always needs an account, so every photograph says who put it there.',
  },
  {
    value: CONTRIBUTE_CREATOR,
    label: 'Only me',
    help: 'You add the photographs and everybody else comes to look. They can still say something and react — it is the pictures that are yours to put in.',
  },
  {
    value: CONTRIBUTE_HOST,
    label: 'Hosts',
    help: 'You and the people you make hosts. Anybody else in the album can ask to be one, and you decide — so the camera can be handed over without the album being.',
  },
];

const PRIVATE_OPTIONS: ContributeOption[] = [
  {
    value: CONTRIBUTE_CREATOR,
    label: 'Only me',
    help: 'You add the photographs and everybody else comes to look. They can still say something and react — it is the pictures that are yours to put in.',
  },
  {
    value: CONTRIBUTE_EVERYONE,
    label: 'Members',
    help: 'Everybody in the album can add to it — the people you added and the people you let in, and nobody else. Adding names who added, so every photograph says who put it there.',
  },
  {
    value: CONTRIBUTE_HOST,
    label: 'Hosts',
    help: 'You and the people you make hosts. Anybody else in the album can ask to be one, and you decide — so the camera can be handed over without the album being.',
  },
];

export function contributeOptions(accessPolicy: string): ContributeOption[] {
  return accessPolicy === PRIVATE ? PRIVATE_OPTIONS : PUBLIC_OPTIONS;
}

/**
 * Every value either list can hold, for a caller validating one.
 *
 * Deliberately not the thing the pills are drawn from: a screen draws the list
 * for the album's own access policy, and this is for the question "is this
 * string one of ours".
 */
export const CONTRIBUTE_OPTIONS: ContributeOption[] = [
  ...PUBLIC_OPTIONS,
  PRIVATE_OPTIONS[1]!,
];

export function ContributeChoice({
  value,
  onChange,
  /**
   * Who can see the album, which decides what this question's answers are
   * called and what order they come in.
   *
   * Passed in rather than read from anywhere, because on the create screen it
   * is a choice somebody is making three fields up and has not saved yet.
   */
  accessPolicy,
  disabled = false,
  /** Shown under the options when this is an album that already exists. */
  note,
}: {
  value: ContributePolicy;
  onChange: (next: ContributePolicy) => void;
  accessPolicy: string;
  disabled?: boolean;
  note?: string;
}) {
  const options = contributeOptions(accessPolicy);
  const chosen = options.find((option) => option.value === value);

  return (
    <>
      <div className="pills">
        {options.map((option) => (
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
