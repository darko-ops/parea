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
import { and, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';

import type { Db } from './db';
import { othersInGroups, titleFor } from './groups';

async function deliver(
  db: Db,
  recipients: string[],
  notification: Notification,
  /**
   * Whose doing this is, where somebody is. Nobody across a block from them,
   * in either direction, is told: a push naming somebody you blocked — or
   * telling somebody who blocked you what you did — undoes the block.
   */
  from?: string,
): Promise<void> {
  const actorIds = from ? await notBlockedWith(db, from, recipients) : recipients;
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
 * The three group notifications, each addressed to a room whose name may
 * depend on who is reading it.
 *
 * Most rooms have no name — a chat is made out of people, and naming one is
 * something you do later if you do it at all — so `groups.name` is null and
 * the title is derived from the other members. Which means it is not one
 * string: the same chat is "Ana" to Jack and "Jack" to Ana, and a single
 * `groupName` on the payload would tell one of them their room is called by
 * their own name.
 *
 * So the recipients are bucketed by what the room is called to each of them,
 * and `deliver` runs once per bucket. A named group is one bucket and one
 * call, exactly as before; a two-person chat is one bucket per person, which
 * is two. Nothing here loops per recipient — the send is still batched across
 * everybody who sees the same title.
 */
async function byTitle(
  db: Db,
  actorIds: string[],
  groupId: string,
  name: string | null,
): Promise<Map<string, string[]>> {
  const buckets = new Map<string, string[]>();
  if (actorIds.length === 0) return buckets;

  // A named room is the same room to everybody, and asking who is in it would
  // be a query whose answer is thrown away.
  const given = name?.trim();
  if (given) return buckets.set(given, actorIds);

  const members = await othersInGroups(db, [groupId], null);
  const all = members.get(groupId) ?? [];
  for (const actorId of actorIds) {
    const title = titleFor(
      null,
      all.filter((person) => person.actorId !== actorId),
    ).title;
    const seen = buckets.get(title);
    if (seen) seen.push(actorId);
    else buckets.set(title, [actorId]);
  }
  return buckets;
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
    /** As stored: null for a room nobody has named. See `byTitle`. */
    groupName: string | null;
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

    const buckets = await byTitle(
      db,
      members.map((m) => m.actorId),
      input.groupId,
      input.groupName,
    );
    for (const [groupName, actorIds] of buckets) {
      await deliver(
        db,
        actorIds,
        {
          kind: 'group_event',
          groupId: input.groupId,
          groupName,
          eventId: input.eventId,
          eventName: input.eventName,
        },
        input.createdBy,
      );
    }
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
 * What to call somebody in a notification.
 *
 * Display name, else handle with its `@`, else "Someone" — the same fallback
 * every other surface uses, and the same one two older routes spell inline at
 * their call sites. Written once here because two more of them were about to
 * be added, and three copies of a fallback chain is how "Someone" turns into
 * "null" on the one path nobody tested.
 */
export async function nameOf(db: Db, actorId: string): Promise<string> {
  const [row] = await db
    .select({ displayName: schema.actors.displayName, handle: schema.actors.handle })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId));
  return row?.displayName?.trim() || (row?.handle ? `@${row.handle}` : 'Someone');
}

/**
 * Somebody said something about a photograph you added.
 *
 * Only the uploader, and never about their own remark. Everybody else in the
 * album finds out by opening it, which is the right amount of noise for a
 * comment that is not addressed to them.
 *
 * The photograph is not in the payload. A push carries a deep link target and
 * the app has no screen that is "one photograph" reachable from cold — it opens
 * the album, which is where the comment is. Sending an id nothing can route to
 * is a field that looks like a feature until somebody taps it.
 */
export async function notifyPhotoComment(
  db: Db,
  input: {
    toActorId: string;
    fromActorId: string;
    eventId: string;
    eventName: string;
    who: string;
    said: string;
  },
): Promise<void> {
  try {
    await deliver(
      db,
      [input.toActorId],
      {
        kind: 'photo_comment',
        eventId: input.eventId,
        eventName: input.eventName,
        who: input.who,
        said: input.said,
      },
      input.fromActorId,
    );
  } catch {
    /* see the module header */
  }
}

/**
 * Somebody said you are in a photograph.
 *
 * The only notification in this product that reports a claim made *about*
 * somebody rather than something that happened to them, which is why it is
 * worth interrupting for: being named in a picture is a thing people want to
 * know about now, and sometimes to undo. The route refuses a self-tag before
 * this is ever reached, so there is no "not yourself" check here to forget.
 */
export async function notifyPhotoTagged(
  db: Db,
  input: { toActorId: string; fromActorId: string; eventId: string; eventName: string; who: string },
): Promise<void> {
  try {
    await deliver(
      db,
      [input.toActorId],
      {
        kind: 'photo_tagged',
        eventId: input.eventId,
        eventName: input.eventName,
        who: input.who,
      },
      input.fromActorId,
    );
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

/**
 * An admin asked you into a group.
 *
 * The group twin of `notifyEventInvite`, and it names the person for the same
 * reason: a group name arriving unprompted is a puzzle, and "Sam asked you"
 * is an answer.
 */
export async function notifyGroupInvite(
  db: Db,
  input: {
    actorIds: string[];
    groupId: string;
    /** As stored: null for a room nobody has named. See `byTitle`. */
    groupName: string | null;
    who: string;
  },
): Promise<void> {
  try {
    const buckets = await byTitle(db, input.actorIds, input.groupId, input.groupName);
    for (const [groupName, actorIds] of buckets) {
      await deliver(db, actorIds, {
        kind: 'group_invited',
        groupId: input.groupId,
        groupName,
        who: input.who,
      });
    }
  } catch {
    /* see the module header */
  }
}

/**
 * Told once, when the group is made, and never again.
 *
 * Separate from `notifyGroupInvite` because the two describe different things
 * happening to the recipient: one is a question waiting in Activity, this one
 * is a room that now exists with them in it. Sending the invitation copy for
 * an add would point somebody at an Accept button that is not there.
 *
 * Fired after the members are written, not before — see the route. A person
 * told about a group that failed to be created has been told a lie, and the
 * reverse is a notification that never arrives, which is recoverable.
 */
export async function notifyGroupAdded(
  db: Db,
  input: {
    actorIds: string[];
    groupId: string;
    /** As stored: null for a room nobody has named. See `byTitle`. */
    groupName: string | null;
    who: string;
  },
): Promise<void> {
  try {
    const buckets = await byTitle(db, input.actorIds, input.groupId, input.groupName);
    for (const [groupName, actorIds] of buckets) {
      await deliver(db, actorIds, {
        kind: 'group_added',
        groupId: input.groupId,
        groupName,
        who: input.who,
      });
    }
  } catch {
    /* see the module header */
  }
}

/**
 * Somebody said something under a moment you shared, or reacted to it —
 * which is now a message in your chat with them, and the push opens that.
 *
 * Only the author, and never about their own remark or reaction — the routes
 * decide that before calling, since they are the ones that know who acted.
 * A reaction is told when it is put on, not when it is taken off: a push
 * saying somebody changed their mind is noise.
 */
export async function notifyMomentComment(
  db: Db,
  input: { toActorId: string; groupId: string; momentId: string; who: string; said: string },
): Promise<void> {
  try {
    await deliver(db, [input.toActorId], {
      kind: 'moment_comment',
      groupId: input.groupId,
      momentId: input.momentId,
      who: input.who,
      said: input.said,
    });
  } catch {
    /* see the module header */
  }
}

export async function notifyMomentReaction(
  db: Db,
  input: { toActorId: string; groupId: string; momentId: string; who: string; emoji: string },
): Promise<void> {
  try {
    await deliver(db, [input.toActorId], {
      kind: 'moment_reaction',
      groupId: input.groupId,
      momentId: input.momentId,
      who: input.who,
      emoji: input.emoji,
    });
  } catch {
    /* see the module header */
  }
}

/** Of `recipients`, the ones no block stands between and `from`. */
async function notBlockedWith(db: Db, from: string, recipients: string[]): Promise<string[]> {
  if (recipients.length === 0) return recipients;
  const rows = await db
    .select({ blocker: schema.blocks.blockerActorId, blocked: schema.blocks.blockedActorId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerActorId, from), inArray(schema.blocks.blockedActorId, recipients)),
        and(eq(schema.blocks.blockedActorId, from), inArray(schema.blocks.blockerActorId, recipients)),
      ),
    );
  const across = new Set(rows.map((r) => (r.blocker === from ? r.blocked : r.blocker)));
  return recipients.filter((id) => !across.has(id));
}

/**
 * Somebody runs a roll now — handed it by name (`from`), or chosen because its
 * Host left Parea and they had added the most to it. See `./succession`.
 */
export async function notifyRollHanded(
  db: Db,
  heirs: { id: string; actorId: string }[],
  from?: string,
): Promise<void> {
  try {
    const who = from ? await nameOf(db, from) : undefined;
    for (const heir of heirs) {
      /*
       * The record the heir's notifications page reads, written here because
       * this is the one place every way a roll changes hands passes through.
       * Only while they still hold it: a second handover since is its own line.
       */
      await db
        .update(schema.events)
        .set({ handedAt: new Date(), handedByActorId: from ?? null })
        .where(and(eq(schema.events.id, heir.id), eq(schema.events.createdBy, heir.actorId)));
      const [event] = await db
        .select({ name: schema.events.name })
        .from(schema.events)
        .where(eq(schema.events.id, heir.id));
      if (!event) continue;
      await deliver(
        db,
        [heir.actorId],
        { kind: 'roll_handed', eventId: heir.id, eventName: event.name, ...(who ? { who } : {}) },
        from,
      );
    }
  } catch {
    /* see the module header */
  }
}

/** The same for a group: its admin handed it over, or its last admin left. */
export async function notifyGroupHanded(
  db: Db,
  heirs: { id: string; actorId: string }[],
  from?: string,
): Promise<void> {
  try {
    const who = from ? await nameOf(db, from) : undefined;
    for (const heir of heirs) {
      // The page's record, for the reason given in `notifyRollHanded`.
      await db
        .update(schema.groupMembers)
        .set({ handedAt: new Date(), handedByActorId: from ?? null })
        .where(
          and(
            eq(schema.groupMembers.groupId, heir.id),
            eq(schema.groupMembers.actorId, heir.actorId),
          ),
        );
      const [group] = await db
        .select({ name: schema.groups.name })
        .from(schema.groups)
        .where(eq(schema.groups.id, heir.id));
      if (!group) continue;
      const buckets = await byTitle(db, [heir.actorId], heir.id, group.name);
      for (const [groupName, actorIds] of buckets) {
        await deliver(
          db,
          actorIds,
          { kind: 'group_handed', groupId: heir.id, groupName, ...(who ? { who } : {}) },
          from,
        );
      }
    }
  } catch {
    /* see the module header */
  }
}
