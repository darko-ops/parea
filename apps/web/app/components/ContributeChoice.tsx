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
 * The same order under both answers, widest first: whoever the album is open
 * to, then its hosts, then just the person making it. It used to differ —
 * "Only me" led a private album — and that made the two lists read as two
 * questions when it is one question whose first answer changes its name.
 *
 * `everyone` is the same stored value under both labels. It has always
 * deferred to the other setting rather than restating it — "whoever the album
 * is open to" — and what changes is which word is true here: on a public album
 * that is anyone with the link, and on a private one it is its members.
 *
 * `nobody` is on neither list. See `CONTRIBUTE_NOBODY`.
 *
 * The same words the app's `ContributeChoice` uses.
 */
const HOSTS: ContributeOption = {
  value: CONTRIBUTE_HOST,
  label: 'Hosts',
  help: 'You and the people you make hosts.',
};

const JUST_ME: ContributeOption = {
  value: CONTRIBUTE_CREATOR,
  label: 'Just me',
  help: 'Everyone else can look.',
};

const PUBLIC_OPTIONS: ContributeOption[] = [
  {
    value: CONTRIBUTE_EVERYONE,
    label: 'Anyone',
    help: 'Anyone with the link can add their photos.',
  },
  HOSTS,
  JUST_ME,
];

const PRIVATE_OPTIONS: ContributeOption[] = [
  {
    value: CONTRIBUTE_EVERYONE,
    label: 'Members',
    help: 'Everyone in the roll can add their photos.',
  },
  HOSTS,
  JUST_ME,
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
  PRIVATE_OPTIONS[0]!,
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
