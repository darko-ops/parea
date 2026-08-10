/**
 * Where a tapped notification goes — design §12.
 *
 * The push payload has always carried a target. `@parea/push` says so in a
 * comment — *the payload is a deep link target, not a data channel* — and
 * nothing has ever read it, so all three notifications arrived and did
 * nothing but bring the app forward on whatever screen it was already on. §12
 * allows exactly one reminder per event; spending it on something that does
 * not take the person anywhere is the whole feature wasted.
 *
 * ## Why a group event opens the group
 *
 * A notification carries an `eventId` and not a link token, and the native
 * client presents a token for everything it does with an event. Two cases
 * follow, and they resolve differently:
 *
 *   - `nudge` and `removal_answered` are about an event this person already
 *     joined, so the token is in the saved list. Open it.
 *   - `group_event` is about an event that did not exist when they last
 *     looked. They have access through membership rather than a link, and
 *     nothing on the device has a token for it. The group screen lists its
 *     events *with* their tokens, so that is where the tap lands: one step
 *     further than ideal, using only what the protocol already gives, rather
 *     than inventing an endpoint to resolve an id to a credential.
 *
 * Pure, and tested, because the alternative to a test is rebuilding the app,
 * reinstalling it, and waiting for a push.
 */

export type NotificationTarget =
  | { screen: 'event'; eventId: string }
  | { screen: 'group'; groupId: string };

/**
 * Reads the target out of a push payload.
 *
 * Everything arrives as a string — Expo's data payload is string-valued — and
 * anything unrecognised returns null rather than guessing. A notification
 * this version does not understand should open the app and stop there, not
 * navigate somewhere arbitrary; the payload is written by a server that may
 * be newer than the installed build.
 */
export function notificationTarget(
  data: Record<string, unknown> | undefined | null,
): NotificationTarget | null {
  if (!data) return null;

  const kind = typeof data.kind === 'string' ? data.kind : null;
  const eventId = typeof data.eventId === 'string' ? data.eventId : null;
  const groupId = typeof data.groupId === 'string' ? data.groupId : null;

  switch (kind) {
    case 'group_event':
      // The event is new and this device holds no token for it. The group
      // does list it, with one.
      return groupId ? { screen: 'group', groupId } : null;
    case 'nudge':
    case 'removal_answered':
      return eventId ? { screen: 'event', eventId } : null;
    default:
      return null;
  }
}
