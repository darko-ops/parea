'use client';

/**
 * "Let people who have my phone number or email find me on Parea."
 *
 * The one privacy switch in this product. It exists because the two identifiers
 * behind it were not given in order to be found by: a handle is a name somebody
 * chose so that people could look them up, whereas a number and an address are
 * how the product *reaches* them, handed over for that, and being found by them
 * is a second use of the same fact. This is where somebody says no to the second
 * without giving up the first.
 *
 * ## What it does not do
 *
 * It is not invisibility, and the sub-line says so. The handle search still
 * finds you, and so do the friends of your friends, who can see you on a mutual
 * friend's list already. Drawing it as "hide me" would be a promise the product
 * does not keep — see `recommendationsFor`, which deliberately does not read
 * this column.
 *
 * ## Why it is its own file
 *
 * `AccountView` holds an invariant worth more than the twenty lines it would
 * have cost to put this inside it: the page that *displays* a profile must have
 * no field in it and must write nothing, so there is exactly one writer for a
 * name, a handle, a bio and a link. `accounts.test.ts` enforces that by reading
 * the file for `<input` and for a PATCH.
 *
 * This is neither a profile field nor a thing the You page shows, so the right
 * answer was not to loosen the invariant — a narrower assertion is one that
 * stops catching the drift it was written for. A component of its own keeps both
 * true, and it is where the app puts the same switch: see `Discoverability` in
 * `Profile.tsx`.
 */

import { useCallback, useState } from 'react';

export function Discoverability({
  /** Whether it is on now. From `/api/account/session`, which reads the column. */
  discoverable,
  /** "47", or null. Never the number — there is no number to send. */
  phoneLast2,
  /** Whether a code sent to that number ever came back. */
  phoneVerified,
  /** The column moved, so the caller's copy of the account is stale. */
  onChanged,
}: {
  discoverable: boolean;
  phoneLast2: string | null;
  phoneVerified: boolean;
  onChanged: () => Promise<void> | void;
}) {
  /**
   * Optimistic, and it puts the switch back when the request fails.
   *
   * A checkbox that waits for a round trip before moving reads as broken. One
   * that moves and *stays* moved after a failure is worse than either: it is a
   * lie about what is stored, on the one control in the product where the
   * difference is who can find somebody.
   *
   * The prop is the *initial* value and this owns it afterwards, deliberately.
   * Syncing on every change of the prop is the obvious alternative and it is the
   * wrong one: the caller reloads the account after each write, so the effect
   * would fire while a request is still out and clobber the position somebody's
   * finger just put the switch in. The cost is a stale switch if another tab
   * moves it, which a reload fixes and which nobody is looking at.
   */
  const [on, setOn] = useState(discoverable);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const set = useCallback(
    async (next: boolean) => {
      setOn(next);
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch('/api/account', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          // Through the account route rather than one of its own: it is one
          // column on the row the profile fields live on, and a route per switch
          // is a route per switch to get the session check wrong in.
          body: JSON.stringify({ discoverable: next }),
        });
        if (!res.ok) throw new Error(String(res.status));
        await onChanged();
      } catch {
        setOn(!next);
        setNote('That did not save. Try again in a moment.');
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  return (
    <section className="panel">
      <h2>Finding you</h2>
      {/* The whole row is the label, so the sentence is part of the target. A
          bare checkbox is a 16px hit area, and this is the one control here
          where a mis-click changes who can find somebody. */}
      <label className="settings-switch">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => void set(e.target.checked)}
        />
        <span>Let people who have my phone number or email find me on Parea</span>
      </label>
      <p className="muted">
        {on
          ? 'Somebody who types your number or your address finds your profile. Turn this off and neither matches.'
          : 'Your number and your address match nothing. People can still find you by your handle.'}
      </p>
      <p className="muted">
        Neither is ever shown to anybody, either way.{' '}
        {phoneVerified && phoneLast2 ? (
          `Your number ends ${phoneLast2}.`
        ) : (
          <>
            You have no number on file &mdash;{' '}
            <a href="/find/friends">Find friends</a> is where you add one.
          </>
        )}
      </p>
      {note && <p className="muted">{note}</p>}
    </section>
  );
}
