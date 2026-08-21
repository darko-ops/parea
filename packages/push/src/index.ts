/**
 * Push delivery — docs/design.md §12.
 *
 * The notable thing about this module is how little it can send. Every kind of
 * notification in the product is enumerated below as a closed union, so adding
 * one is an edit to a type rather than a call site somebody slipped in — and
 * `NOTIFICATION_KINDS` makes the set countable, which is what keeps the
 * privacy policy's claim about them honest. The concept is explicit: one
 * well-timed reminder, not notification spam, and the feature test applies to
 * notifications as much as anything else — does this help people contribute,
 * find, or retrieve shared photos?
 *
 * Three of the four are about photographs. The fourth is about a person
 * standing outside a private event, and it earns its place because nothing
 * else tells the host: the request simply waits until they happen to look.
 *
 * No "someone added 3 photos". No digests. No re-engagement. Those are the
 * notifications that make people turn all of them off, and the one that
 * matters — a new event in your group — dies with them.
 *
 * Talks to Expo's push service, which accepts an ExponentPushToken without a
 * server credential. `EXPO_ACCESS_TOKEN` is honoured when set, which Expo
 * recommends once a project has one.
 */

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
/** Expo's documented per-request limit. */
const CHUNK = 100;

export type Notification =
  /** One per event, ever. Enforced in the schema, not here. */
  | { kind: 'nudge'; eventId: string; eventName: string; photoCount: number }
  /** The thing a group is actually for. */
  | { kind: 'group_event'; groupId: string; eventId: string; eventName: string; groupName: string }
  /** Transactional: you asked for a photo to come down and someone decided. */
  | { kind: 'removal_answered'; eventId: string; removed: boolean }
  /**
   * Somebody is at the door of a private event and cannot get in until the
   * host says so. The only notification that reports a person waiting on a
   * decision rather than an outcome, which is why it is worth interrupting
   * for: nothing else will tell them, and the request sits until it is seen.
   */
  | { kind: 'access_requested'; eventId: string; eventName: string; who: string }
  /** Somebody asked to be your friend. Nothing else tells you. */
  | { kind: 'friend_requested'; who: string }
  /** A friend put you in an event, rather than sending you a link. */
  | { kind: 'event_invited'; eventId: string; eventName: string; who: string }
  /**
   * An admin asked you into a group.
   *
   * Its own kind rather than reusing `event_invited` with a group's name in
   * it: tapping one should open an event and tapping the other a group, and a
   * notification whose target depends on guessing which id it carries is one
   * that eventually opens the wrong thing.
   */
  | { kind: 'group_invited'; groupId: string; groupName: string; who: string };

/**
 * The set, enumerable at runtime.
 *
 * A union's members cannot be counted by anything but a person reading them,
 * and the privacy policy makes a claim about how many there are and what each
 * one is for. Typed as a record over the union, so adding a fourth kind is a
 * compile error here and the test that reads this list fails against the page
 * that has not been updated — which is how the page and the product stay the
 * same shape.
 */
const KINDS: Record<Notification['kind'], true> = {
  nudge: true,
  group_event: true,
  removal_answered: true,
  access_requested: true,
  friend_requested: true,
  event_invited: true,
  group_invited: true,
};

export const NOTIFICATION_KINDS = Object.keys(KINDS) as Notification['kind'][];

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

/**
 * Copy lives here rather than at the call sites, so all of it can be read at
 * once. A notification is the only part of this product that interrupts
 * someone, and the whole set fitting on one screen is the point.
 */
export function render(notification: Notification): { title: string; body: string } {
  switch (notification.kind) {
    case 'nudge':
      return {
        title: notification.eventName,
        body:
          notification.photoCount > 0
            ? `${notification.photoCount} photos are waiting. Add yours?`
            : 'Nobody has added photos yet. Yours would start it off.',
      };
    case 'group_event':
      return {
        title: notification.groupName,
        body: `${notification.eventName} — add your photos.`,
      };
    case 'removal_answered':
      return {
        title: notification.removed ? 'Photo taken down' : 'Photo kept',
        body: notification.removed
          ? 'The photo you asked about has been removed.'
          : 'The host decided to keep the photo you asked about.',
      };
    case 'access_requested':
      return {
        title: notification.eventName,
        // Named, because the decision is about a person and the host is being
        // asked to make it. "Someone wants in" is a worse question to answer.
        body: `${notification.who} is asking to come in.`,
      };
    case 'friend_requested':
      return {
        title: 'Parea',
        body: `${notification.who} wants to be friends.`,
      };
    case 'event_invited':
      return {
        title: notification.eventName,
        // The person, not the event, is the reason to open this: an event name
        // out of nowhere is a puzzle, and a name is an explanation.
        //
        // "Asked you" rather than "added you", because that is now what
        // happened — an invitation waits for an answer, and telling somebody
        // they were added would be describing access they do not yet have.
        body: `${notification.who} asked you into this.`,
      };
    case 'group_invited':
      return {
        title: notification.groupName,
        // The same sentence as the event's, for the same reason — the person
        // is the explanation for a name arriving out of nowhere. "Into this"
        // rather than "into this group": the title says which it is.
        body: `${notification.who} asked you into this.`,
      };
  }
}

export function toMessage(token: string, notification: Notification): PushMessage {
  const { title, body } = render(notification);
  return {
    to: token,
    title,
    body,
    // Strings only: the payload is a deep link target, not a data channel.
    data: Object.fromEntries(
      Object.entries(notification).map(([k, v]) => [k, String(v)]),
    ),
  };
}

export type DeliveryResult = {
  sent: number;
  failed: number;
  /**
   * Tokens the device store should forget: the app was uninstalled, or the
   * token was reissued. Left in place they are permanent errors on every
   * future send.
   */
  unregistered: string[];
};

export type Fetcher = typeof fetch;

/**
 * Send, and report which tokens are dead.
 *
 * Never throws for a delivery failure. A notification is the least important
 * thing in the system — nothing depends on it having arrived — so a push
 * outage must not fail the request or the job that triggered it.
 */
export async function sendAll(
  messages: PushMessage[],
  options: { fetcher?: Fetcher; accessToken?: string } = {},
): Promise<DeliveryResult> {
  const send = options.fetcher ?? fetch;
  const token = options.accessToken ?? process.env.EXPO_ACCESS_TOKEN;

  const result: DeliveryResult = { sent: 0, failed: 0, unregistered: [] };
  const valid = messages.filter((m) => isExpoPushToken(m.to));
  result.failed += messages.length - valid.length;

  for (let at = 0; at < valid.length; at += CHUNK) {
    const chunk = valid.slice(at, at + CHUNK);
    try {
      const response = await send(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        result.failed += chunk.length;
        continue;
      }

      const body = (await response.json()) as {
        data?: { status?: string; details?: { error?: string } }[];
      };
      const tickets = body.data ?? [];

      chunk.forEach((message, index) => {
        const ticket = tickets[index];
        if (ticket?.status === 'ok') {
          result.sent++;
          return;
        }
        result.failed++;
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          result.unregistered.push(message.to);
        }
      });
    } catch {
      result.failed += chunk.length;
    }
  }

  return result;
}
