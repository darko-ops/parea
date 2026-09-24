/**
 * The first thing on the Notifications page, for somebody who has nothing.
 *
 * The page used to open with one grey sentence — "Nothing yet. When somebody
 * adds photos to an album you are in…" — which is accurate and reads as a
 * screen that failed to fetch. Everywhere else in this product an empty state
 * says what the space is for; this one said what was absent and then explained
 * the absence.
 *
 * So it is a row, drawn the way the rows under it will be drawn, saying the
 * same thing in the voice of the thing that will be saying the rest.
 *
 * ## It is not pretending to be a notification
 *
 * The distinction matters, because a synthetic row in a list of things that
 * actually happened is a lie the moment somebody cannot tell. Three things
 * keep it honest and each is deliberate:
 *
 *   - It carries the mark rather than a face. Every other row is somebody, and
 *     the letter that stands in for a missing picture is *their* initial; this
 *     one is the product, and it wears the product's own drawing.
 *   - It has no time. A notification is a thing that happened at a moment, and
 *     "just now" here would be a timestamp invented for an event that never
 *     occurred.
 *   - It has no `⋯`. Every real row can be hidden, because a real row is
 *     somebody else's action landing on your screen. This one leaves on its
 *     own, the moment there is anything to replace it.
 *
 * Which is also why it is not stored, not counted, and never reaches the
 * badge: the rail's number is what is waiting on you, and nothing here is.
 */

import { Mark } from './Mark';

export function Welcome() {
  return (
    <ul className="activity activity-welcome">
      <li className="activity-row">
        <span>
          {/* The mark, at the size a row's face is drawn at, so the column of
              squares down the left stays a column. */}
          <span className="activity-thumb welcome-mark" aria-hidden="true">
            <Mark size={26} />
          </span>
          <span className="activity-said">
            <span className="activity-who">Parea</span> Welcome. When somebody
            adds photos to an album you are in, says something about yours, or
            opens one to you, it turns up here.
          </span>
        </span>
      </li>
    </ul>
  );
}
