'use client';

/**
 * Who can see it — the one control, in the two places it is asked.
 *
 * It is asked when an album is made and again when one is managed, and those
 * were two different questions until now: the create form offered "anyone with
 * the link" or "you approve each person", the phone offered "anyone with the
 * link" or "sign in", and Manage offered nothing at all because the column was
 * write-once. Three surfaces, three vocabularies, one column.
 *
 * The middle setting is the one that was missing from the web, and it is the
 * one most people mean by private: the link admits, and you have to say who
 * you are to use it. Without it, choosing "private" here meant every person
 * you deliberately sent a link to had to stand at the door and ask — which is
 * the right behaviour for a link that may travel past the guest list, and the
 * wrong one for a link sent to six friends.
 *
 * The copy is the interesting part and it lives here, once. Each option says
 * what happens to the person on the other end, not what the policy is called:
 * "they sign in and they are in" is a fact somebody can predict from, where
 * "account required" is a setting they have to interpret.
 */

import { ACCOUNT_REQUIRED, LINK_OPEN, REQUEST_ACCESS } from '@parea/core';

export type AccessPolicy =
  | typeof LINK_OPEN
  | typeof ACCOUNT_REQUIRED
  | typeof REQUEST_ACCESS;

export const ACCESS_OPTIONS: {
  value: AccessPolicy;
  label: string;
  /** What happens to somebody you send the link to. */
  help: string;
}[] = [
  {
    value: LINK_OPEN,
    label: 'Anyone with the link',
    help: 'Whoever holds the link sees the photos, and so does anyone who is told the phrase. No account needed to look; adding photos always needs one.',
  },
  {
    value: ACCOUNT_REQUIRED,
    label: 'Private — they sign in',
    help: 'Whoever you send the link to signs in and is straight in. Nobody has to ask and you do not have to approve anyone — but the link alone opens nothing, so a forwarded link is no use without an account.',
  },
  {
    value: REQUEST_ACCESS,
    label: 'I approve each person',
    help: 'Holding the link only gets them as far as asking. You approve each person, under Members. Use this when the link may travel further than the guest list.',
  },
];

/**
 * The same three, asked as switches rather than as a row of names.
 *
 * The create screen asks it this way because somebody making an album is
 * deciding several things at once — who can see it, whether the link admits,
 * whether there is a phrase — and a list of switches is how that reads. Manage
 * asks it as three names because by then it is one settled fact being changed.
 *
 * Both end up in the same column, through this function and nowhere else. The
 * mapping is the part worth keeping in one place: "private" and "I approve
 * each person" are not two settings, they are two of the three values, and
 * approval implies private because a policy cannot be both.
 */
export function policyFor({
  isPrivate,
  approve,
}: {
  isPrivate: boolean;
  approve: boolean;
}): AccessPolicy {
  if (approve) return REQUEST_ACCESS;
  return isPrivate ? ACCOUNT_REQUIRED : LINK_OPEN;
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
