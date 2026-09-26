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
  /**
   * Somebody said something about a photograph you added.
   *
   * Worth interrupting for because it is addressed to you and nothing else
   * will say so — a remark under your picture is not a thing you would go
   * looking for. Only the uploader is told, and never about their own remark.
   */
  | { kind: 'photo_comment'; eventId: string; eventName: string; who: string; said: string }
  /**
   * Somebody said you are in a photograph.
   *
   * The only push in this product that reports a claim made *about* somebody
   * rather than something that happened to them, which is exactly why it
   * cannot wait to be found: being named in a picture is a thing people want
   * to know about now, and sometimes to undo.
   */
  | { kind: 'photo_tagged'; eventId: string; eventName: string; who: string }
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
  | { kind: 'group_invited'; groupId: string; groupName: string; who: string }
  /**
   * Somebody made a group and put you in it.
   *
   * Not `group_invited`, and the difference is not cosmetic: there is nothing
   * to answer here. A group made from the people who were already at the same
   * events adds them outright — they had the photographs already, and asking
   * eleven people to accept a room they are already effectively in is a
   * formality that reads as eleven chores. So the wording tells rather than
   * asks, because a notification that says "asked you" beside no Accept button
   * is a notification about a control that is not there.
   */
  | { kind: 'group_added'; groupId: string; groupName: string; who: string };

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
  photo_comment: true,
  photo_tagged: true,
  event_invited: true,
  group_invited: true,
  group_added: true,
};

export const NOTIFICATION_KINDS = Object.keys(KINDS) as Notification['kind'][];

/**
 * The Android channel these are delivered on, by id.
 *
 * Android decides whether a notification drops down over whatever somebody is
 * looking at, and it decides it from the *channel*, not from the message: a
 * channel at `DEFAULT` importance makes a sound and adds a line to the shade
 * and never interrupts. That was the bug — every notification in this product
 * arrived correctly and silently joined a list nobody had a reason to open.
 *
 * So the channel is named here, beside the messages that ask for it, and the
 * app creates one with this id at high importance. The two have to agree: a
 * `channelId` naming a channel that does not exist falls back to whatever
 * Expo's default is, which is the behaviour this exists to stop. `config.test`
 * in the app checks the string.
 *
 * Importance is fixed at creation and Android will not let an app raise it
 * afterwards, so if this ever needs to change it changes by becoming a new id
 * rather than by editing the channel.
 */
export const NOTIFICATION_CHANNEL = 'default';

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /**
   * Android's channel, and the whole of whether this drops down. See above.
   * Ignored on iOS, which decides presentation from the person's settings.
   */
  channelId: string;
  /**
   * FCM's delivery priority, which is a different thing from the channel and
   * is also required: a normal-priority message is allowed to wait for the
   * next time the phone wakes up, which for a device in Doze overnight can be
   * hours. Everything this product sends is about something that just
   * happened, and a reminder that arrives the next morning is worse than none.
   */
  priority: 'high';
  /**
   * Audible, and that is a decision rather than a default.
   *
   * §12 allows so few of these that none of them is noise — one reminder per
   * event, ever — and a notification nobody hears is one more thing found
   * later on a lock screen. The app silences it again while it is open, where
   * a sound would be the product reacting to something already on the screen;
   * see `setNotificationHandler`.
   */
  sound: 'default';
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
    case 'photo_comment':
      return {
        title: notification.eventName,
        /*
         * The remark, not the fact of one.
         *
         * "Maya commented on your photo" makes somebody open the app to find
         * out whether they wanted to — and most of the time the whole content
         * of the notification is six words that could have been in it. Trimmed
         * where a notification is trimmed anyway, but trimmed by us so it ends
         * in an ellipsis rather than mid-word at whatever width the phone is.
         */
        body: `${notification.who}: ${
          notification.said.length > 80
            ? `${notification.said.slice(0, 80).trimEnd()}…`
            : notification.said
        }`,
      };
    case 'photo_tagged':
      return {
        title: notification.eventName,
        // Named, because a tag is somebody's claim and the person who made it
        // is half of what you are being told.
        body: `${notification.who} tagged you in a photo.`,
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
    case 'group_added':
      return {
        title: notification.groupName,
        // "Put you in", not "asked you into": this one is already done, and
        // there is no Accept waiting anywhere for it. Saying it plainly is
        // also the only warning somebody gets that a room now exists with
        // their name in it, so it must not be softened into an invitation.
        body: `${notification.who} put you in this.`,
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
    /*
     * The three fields that decide whether anybody sees this.
     *
     * Not per-kind, and that is the point: there is no tier here. §12 is a
     * list of four things worth interrupting somebody for, and anything that
     * did not deserve a banner would not deserve to be sent. A notification
     * this product delivers quietly into a list is a notification it should
     * not have delivered.
     */
    channelId: NOTIFICATION_CHANNEL,
    priority: 'high',
    sound: 'default',
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
