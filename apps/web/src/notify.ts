/**
 * Sending the three notifications — docs/design.md §12.
 *
 * Every function here is fire-and-forget and swallows its own failures.
 * Nothing in the product depends on a notification arriving, so a push outage
 * must never fail the request that triggered it — someone creating an event
 * should not see an error because Expo is down.
 *
 * The device store is pruned as a side effect: Expo tells us which tokens
 * belong to uninstalled apps, and leaving them in place makes every future
 * send partly fail forever.
 */

import { schema } from '@parea/core';
import { sendAll, toMessage, type Notification } from '@parea/push';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import type { Db } from './db';

async function deliver(
  db: Db,
  actorIds: string[],
  notification: Notification,
): Promise<void> {
  if (actorIds.length === 0) return;

  const devices = await db
    .select({ token: schema.devices.pushToken })
    .from(schema.devices)
    .where(
      and(
        inArray(schema.devices.actorId, actorIds),
        isNotNull(schema.devices.pushToken),
      ),
    );

  const tokens = [...new Set(devices.map((d) => d.token!).filter(Boolean))];
  if (tokens.length === 0) return;

  const result = await sendAll(tokens.map((t) => toMessage(t, notification)));

  if (result.unregistered.length > 0) {
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.pushToken, result.unregistered));
  }
}

/**
 * A new event in a group — the reason a group is worth joining.
 *
 * Everyone except whoever made it: telling someone about the thing they just
 * did is how a notification budget gets spent on nothing.
 */
export async function notifyGroupEvent(
  db: Db,
  input: {
    groupId: string;
    groupName: string;
    eventId: string;
    eventName: string;
    createdBy: string;
  },
): Promise<void> {
  try {
    const members = await db
      .select({ actorId: schema.groupMembers.actorId })
      .from(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.groupId, input.groupId),
          ne(schema.groupMembers.actorId, input.createdBy),
        ),
      );

    await deliver(db, members.map((m) => m.actorId), {
      kind: 'group_event',
      groupId: input.groupId,
      groupName: input.groupName,
      eventId: input.eventId,
      eventName: input.eventName,
    });
  } catch {
    // Deliberately silent. See the module header.
  }
}

/**
 * Someone asked for a photo of themselves to come down, and a host decided.
 *
 * The one transactional notification. Without it the person who asked has no
 * way to learn the answer — they may have no account and no reason to return
 * to the event.
 */
export async function notifyRemovalAnswered(
  db: Db,
  input: { reporterActorId: string | null; eventId: string; removed: boolean },
): Promise<void> {
  if (!input.reporterActorId) return;
  try {
    await deliver(db, [input.reporterActorId], {
      kind: 'removal_answered',
      eventId: input.eventId,
      removed: input.removed,
    });
  } catch {
    /* see the module header */
  }
}

/**
 * Somebody is waiting at the door of a private event.
 *
 * To the creator and to any admins of the group it belongs to — the same set
 * `authorize` lets administer it, because approving is an administrative act
 * and telling anyone else would be telling them who is asking about an event
 * they cannot answer for.
 *
 * The one notification that reports a person rather than a photograph, and it
 * earns that because nothing else reports it at all: a request sits in the
 * manage screen until a host happens to look, and "happens to look" is not a
 * mechanism.
 */
export async function notifyAccessRequested(
  db: Db,
  input: {
    eventId: string;
    eventName: string;
    createdBy: string;
    groupId: string | null;
    /** What to call the person asking. Never their email address. */
    who: string;
  },
): Promise<void> {
  try {
    const admins = input.groupId
      ? await db
          .select({ actorId: schema.groupMembers.actorId })
          .from(schema.groupMembers)
          .where(
            and(
              eq(schema.groupMembers.groupId, input.groupId),
              eq(schema.groupMembers.role, 'admin'),
            ),
          )
      : [];

    // Deduplicated: the creator is usually also a group admin, and `deliver`
    // would otherwise send them two of the same notification.
    const targets = [...new Set([input.createdBy, ...admins.map((a) => a.actorId)])];

    await deliver(db, targets, {
      kind: 'access_requested',
      eventId: input.eventId,
      eventName: input.eventName,
      who: input.who,
    });
  } catch {
    /* see the module header */
  }
}

/** Somebody asked to be your friend. Nothing else would tell you. */
export async function notifyFriendRequest(
  db: Db,
  input: { toActorId: string; who: string },
): Promise<void> {
  try {
    await deliver(db, [input.toActorId], { kind: 'friend_requested', who: input.who });
  } catch {
    /* see the module header */
  }
}

/**
 * A friend put you in an event.
 *
 * The one notification about an event you have never seen, which is why it
 * names the person rather than leading with the event: an unfamiliar event
 * name arriving unprompted is a puzzle, and "Sam added you" is an answer.
 */
export async function notifyEventInvite(
  db: Db,
  input: { actorIds: string[]; eventId: string; eventName: string; who: string },
): Promise<void> {
  try {
    await deliver(db, input.actorIds, {
      kind: 'event_invited',
      eventId: input.eventId,
      eventName: input.eventName,
      who: input.who,
    });
  } catch {
    /* see the module header */
  }
}
