'use client';

/**
 * The first thing on the Notifications page, for somebody who has nothing.
 *
 * The page used to open with one grey sentence — "Nothing yet. When somebody
 * adds photos to an album you are in…" — which is accurate and reads as a
 * screen that failed to fetch. Everywhere else in this product an empty state
 * says what the space is for; this one said what was absent and then explained
 * the absence.
 *
 * So it is a row, and it is a row like the ones that will replace it: a
 * picture, a name that opens a profile, a sentence, a time, and the same `⋯`
 * that hides it.
 *
 * ## What makes it honest rather than a mock-up
 *
 * It was drawn as deliberately *unlike* a notification at first — no face, no
 * time, no menu — on the reasoning that a synthetic row in a list of things
 * that happened is a lie the moment somebody cannot tell. The answer to that
 * is not to make the row look broken; it is to make each of those three
 * things true:
 *
 *   - **The name is an account.** `parea` is a real actor with a real address
 *     behind it, seeded by `0037_parea_account.sql`, and `@parea` opens a
 *     profile like anybody's. It has no powers anywhere in the product — see
 *     `parea.ts`.
 *   - **The time is a real moment**, and it is the one this row is about: when
 *     you joined. "Just now" would have been a timestamp invented for an event
 *     that never happened; "3 days ago" is when Parea had something to welcome.
 *   - **Hiding it works**, and sticks, through the same endpoint every other
 *     row uses. The key is a constant rather than a uuid because there is one
 *     of these per reader, ever.
 *
 * It still never reaches the badge. The rail's number is what is *waiting* on
 * you, and this is not waiting on anything.
 *
 * The picture is the mark rather than a photograph, which is not an exception:
 * it is what an account with no avatar key falls back to, the way anybody
 * without one falls back to their initial. Parea's initial is its logo.
 */

import { useState } from 'react';

import { PAREA_HANDLE, PAREA_NAME, WELCOME_KEY } from '@/parea';

import { Mark } from './Mark';
import { Menu } from './Menu';

export function Welcome({
  /**
   * When you arrived, worded on the server like every other time on this page.
   *
   * Null only for a browser this product has never seen: no actor, so no
   * moment to name. The row is still drawn — somebody reading an empty
   * Notifications page is exactly who the sentence is for — and it is the one
   * case where it carries no time, because there is not one.
   */
  when,
}: {
  when: string | null;
}) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const hide = async () => {
    // Optimistic, and it does not come back on a failure — unlike a real row,
    // there is nothing underneath this to be wrong about. A welcome that
    // reappeared because a request failed would be the one thing worse than
    // one that will not go away.
    setHidden(true);
    await fetch('/api/activity/hidden', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: WELCOME_KEY }),
    }).catch(() => {});
  };

  return (
    <ul className="activity">
      <li className="activity-row">
        <a href={`/u/${PAREA_HANDLE}`} aria-label={`${PAREA_NAME} welcomed you`}>
          {/* Where a face goes, and the same 34px square: an account with no
              avatar key falls back to something that belongs to it, which for
              a person is their initial and for the product is its mark. */}
          <span className="activity-thumb welcome-mark" aria-hidden="true">
            <Mark size={26} />
          </span>
          <span className="activity-said">
            <span className="activity-who">{PAREA_NAME}</span> welcomed you.
            When somebody adds photos to an album you are in, says something
            about yours, or opens one to you, it turns up here.
          </span>
          {when && <span className="activity-when">{when}</span>}
        </a>
        <Menu label={`Options for: ${PAREA_NAME} welcomed you`}>
          {(close) => (
            <button
              onClick={() => {
                close();
                void hide();
              }}
            >
              Hide this
            </button>
          )}
        </Menu>
      </li>
    </ul>
  );
}
