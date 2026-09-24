'use client';

/**
 * Handing somebody your profile.
 *
 * The one thing a person opens their own profile to *do to it*, and the web
 * had no way to. The app has had `Share profile` beside `Edit profile` since
 * the two destructive verbs moved out of that row; this is the same pair.
 *
 * ## Two behaviours, and the second is not a fallback
 *
 * On a phone `navigator.share` opens the sheet the operating system already
 * has, which is where somebody's messages, mail and AirDrop are — the same
 * sheet the app's own button opens, because it *is* that sheet. On a laptop
 * there is usually no such thing, and the honest answer to "share this" there
 * is the link on the clipboard: every one of those destinations is a paste
 * away, and a dialog listing three of them would be a worse version of the
 * browser somebody is already in.
 *
 * So the label says which it will do, before it does it. A button that reads
 * `Share` and silently copies is a button that looks broken to the person who
 * expected a sheet, and one that reads `Copy link` and opens a sheet is the
 * reverse. Decided after mount, because `navigator` is not a thing during
 * render on the server and a label that changes on hydration is worse than
 * one that arrives a frame late.
 *
 * ## Nothing to hand out without a handle
 *
 * The link is `/u/<handle>`, and an account that has never chosen one has no
 * page for this to point at. Disabled rather than absent: the control is part
 * of a pair and a row with one half missing reads as a layout that failed,
 * where a dimmed half reads as a thing you could have — which is true, and
 * `Edit` beside it is where the handle is chosen.
 */

import { useEffect, useState } from 'react';

export function ShareProfile({ handle }: { handle: string | null }) {
  /** Null until the browser has been asked. See above. */
  const [sheet, setSheet] = useState<boolean | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    setSheet(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const share = async () => {
    if (!handle) return;
    /*
     * Built from the page's own origin rather than from a constant.
     *
     * A link copied on a preview deployment should open that deployment: the
     * person copying it is looking at the thing they mean to hand over, and a
     * hard-coded production address would send them somewhere else — which is
     * exactly the case where a wrong link is hardest to notice.
     */
    const url = new URL(`/u/${handle}`, window.location.origin).toString();
    try {
      if (sheet) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setSaid('Link copied');
    } catch {
      // A cancelled share sheet throws, and so does a clipboard a browser will
      // not give up without a gesture it recognises. Neither is a failure
      // worth a red line on somebody's profile; the second leaves the link on
      // screen to copy by hand, which is what the note does.
      if (!sheet) setSaid('Could not copy — the address is parea.photos/u/' + handle);
    } finally {
      // Long enough to read and gone before it is furniture.
      setTimeout(() => setSaid(null), 4000);
    }
  };

  return (
    <>
      <button
        className="you-share"
        disabled={!handle}
        title={handle ? undefined : 'Choose a handle first — Edit is where'}
        onClick={() => void share()}
      >
        {sheet ? 'Share' : 'Copy link'}
      </button>
      {/* `role="status"`, so it is announced without taking focus away from
          the button somebody just pressed. */}
      {said && (
        <span className="you-said" role="status">
          {said}
        </span>
      )}
    </>
  );
}
