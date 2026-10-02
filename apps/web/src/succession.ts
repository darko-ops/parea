/**
 * Who runs an album or a group next — handed on, or left behind.
 *
 * Two ways the person running something stops running it. They hand it to
 * somebody, by name, while they are still here; or they go — close their
 * account, leave the group — and somebody has to be chosen for them, because a
 * roll whose Host has gone can never again be renamed, opened, closed or have
 * anybody let in, and a group with no admin can never again approve a request.
 *
 * ## Who is chosen
 *
 * Whoever has added the most to it: the most photographs still in the album,
 * or across the group's albums. The person who has put the most of themselves
 * into the thing is the one with the most reason to look after it, and it is a
 * fact everybody in it can see for themselves rather than a judgement the
 * product made. Ties, and a room where nobody has added anything, go to whoever
 * has been there longest — the rule groups used before this, so a group with
 * no albums is unchanged.
 *
 * One rule, here, because three callers apply it — closing an account, leaving
 * a group, and migration 0061 for the rolls orphaned before it — and the day
 * two of them disagreed, who ended up running a roll would depend on how the
 * last person left it.
 *
 * ## Who can be chosen
 *
 * For a roll, somebody in it with an account: `authorize` grants `administer`
 * to the creator, but every administering route also wants a signed-in person,
 * so a guest made Host would hold a role nobody could exercise. Nobody
 * eligible means the roll stays as it is, as it did before.
 *
 * Somebody suspended is passed over while anybody else is there. They cannot
 * sign in, so the role would sit where nobody can use it — but a group whose
 * only other member is suspended still gets them, because the suspension may
 * be lifted and "nobody, for good" is the outcome this exists to prevent.
 */

import { schema } from '@parea/core';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from './db';
import { blockedEitherWay } from './moderation';

/** Live photographs: the ones anybody can still see. */
const LIVE = sql`p.deleted_at is null and p.status = 'ready'`;

const suspended = (actor: SQL) =>
  sql`exists (select 1 from "suspension" s where s.actor_id = ${actor} and s.lifted_at is null)`;

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

/**
 * Every live roll made by one of `from`, handed to its heir.
 *
 * Called by `deleteAccount` once the actors have lost their accounts and their
 * participant rows, so they are not candidates for their own rolls. One
 * statement over all of them, the way the group half is.
 *
 * The heir's participant row goes back to `member`: the creator is a Host by
 * being the creator, and `role = 'host'` on their row as well would be the same
 * fact stored twice (see `/api/events/[id]/hosts`).
 */
export async function passOnRolls(db: Db, from: string[]): Promise<Heir[]> {
  if (from.length === 0) return [];
  return passOnRollsWhere(db, sql`e.created_by in (${uuidList(from)})`);
}

/** Who was chosen, for what — so they can be told. */
export type Heir = { id: string; actorId: string };

/**
 * The same, for every live roll matching `where` — a condition on `e`, the
 * event. Exported for the test that pins migration 0061 to this rule.
 */
export async function passOnRollsWhere(db: Db, where: SQL): Promise<Heir[]> {
  const result = await db.execute(sql`
    with heir as (
      select distinct on (e.id) e.id as event_id, ep.actor_id
      from "event" e
      join "event_participant" ep on ep.event_id = e.id and ep.actor_id <> e.created_by
      join "actor" a on a.id = ep.actor_id and a.account_id is not null
      where ${where} and e.deleted_at is null
      order by
        e.id,
        ${suspended(sql`ep.actor_id`)} asc,
        (select count(*) from "photo" p where p.event_id = e.id and p.uploader_id = ep.actor_id and ${LIVE}) desc,
        ep.first_seen_at asc
    ),
    moved as (
      update "event" set created_by = heir.actor_id
      from heir
      where "event".id = heir.event_id
      returning "event".id, "event".created_by
    )
    update "event_participant" ep set role = 'member'
    from moved
    where ep.event_id = moved.id and ep.actor_id = moved.created_by
    returning ep.event_id as "id", ep.actor_id as "actorId"
  `);
  return rowsOf(result) as Heir[];
}

/**
 * Every group among `groupIds` with nobody left to run it gets its heir.
 *
 * Groups with an admin are left alone: the rule is for a group that has lost
 * its last one, not a way of re-electing whoever is ahead.
 */
export async function crownGroups(db: Db, groupIds: string[]): Promise<Heir[]> {
  if (groupIds.length === 0) return [];
  const result = await db.execute(sql`
    update "group_member" gm set role = 'admin'
    from (
      select distinct on (g.group_id) g.group_id, g.actor_id
      from "group_member" g
      where g.group_id in (${uuidList(groupIds)})
        and not exists (
          select 1 from "group_member" a where a.group_id = g.group_id and a.role = 'admin'
        )
      order by
        g.group_id,
        ${suspended(sql`g.actor_id`)} asc,
        (
          select count(*) from "photo" p
          join "event" e on e.id = p.event_id
          where e.group_id = g.group_id and e.deleted_at is null
            and p.uploader_id = g.actor_id and ${LIVE}
        ) desc,
        g.joined_at asc
    ) heir
    where gm.group_id = heir.group_id and gm.actor_id = heir.actor_id
    returning gm.group_id as "id", gm.actor_id as "actorId"
  `);
  return rowsOf(result) as Heir[];
}

export type HandOver = 'handed_over' | 'not_yours' | 'not_eligible' | 'same_person';

/**
 * The roll's Host makes somebody else its Host.
 *
 * Only the Host — not a group admin who can also administer a group's roll.
 * Being Host is the one thing about a roll that is a person's own, and handing
 * it on is theirs to do.
 *
 * To somebody already in it, with an account, who is not suspended, and with
 * no block between them: the same people `passOnRolls` could choose, less the
 * ones the giver has said they want nothing to do with.
 *
 * The giver stays in, as a co-host. They made it; taking away their own camera
 * as the price of handing the album on would make the handover something to
 * put off, and on an album set to Hosts that is the only way they could still
 * add. The new Host can take it back like any other co-host.
 */
export async function handOverRoll(
  db: Db,
  eventId: string,
  from: string,
  to: string,
): Promise<HandOver> {
  if (from === to) return 'same_person';
  const [event] = await db
    .select({ createdBy: schema.events.createdBy })
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), isNull(schema.events.deletedAt)))
    .limit(1);
  if (!event || event.createdBy !== from) return 'not_yours';

  const [heir] = (await db.execute(sql`
    select 1 as ok
    from "event_participant" ep
    join "actor" a on a.id = ep.actor_id and a.account_id is not null
    where ep.event_id = ${eventId}::uuid and ep.actor_id = ${to}::uuid
      and not ${suspended(sql`ep.actor_id`)}
  `).then(rowsOf)) as { ok: number }[];
  if (!heir || (await blockedEitherWay(db, from, to))) return 'not_eligible';

  await db.transaction(async (tx) => {
    await tx.update(schema.events).set({ createdBy: to }).where(eq(schema.events.id, eventId));
    await tx
      .update(schema.eventParticipants)
      .set({ role: 'member' })
      .where(
        and(eq(schema.eventParticipants.eventId, eventId), eq(schema.eventParticipants.actorId, to)),
      );
    await tx
      .insert(schema.eventParticipants)
      .values({ eventId, actorId: from, role: 'host' })
      .onConflictDoUpdate({
        target: [schema.eventParticipants.eventId, schema.eventParticipants.actorId],
        set: { role: 'host' },
      });
  });
  return 'handed_over';
}

/**
 * A group's admin makes another member its admin, and steps down.
 *
 * A handover rather than a promotion: what people ask for is "make Sam the
 * admin instead of me", and a group with two admins is the case `removeMember`
 * already has to refuse to referee. The giver stays in as a member.
 */
export async function handOverGroup(
  db: Db,
  groupId: string,
  from: string,
  to: string,
): Promise<HandOver> {
  if (from === to) return 'same_person';
  const roles = await db
    .select({ actorId: schema.groupMembers.actorId, role: schema.groupMembers.role })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId));
  const mine = roles.find((r) => r.actorId === from);
  if (mine?.role !== 'admin') return 'not_yours';
  if (!roles.some((r) => r.actorId === to)) return 'not_eligible';

  const [barred] = (await db.execute(sql`
    select 1 as ok where ${suspended(sql`${to}::uuid`)}
  `).then(rowsOf)) as { ok: number }[];
  if (barred || (await blockedEitherWay(db, from, to))) return 'not_eligible';

  await db.transaction(async (tx) => {
    const member = (actorId: string) =>
      and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.actorId, actorId));
    await tx.update(schema.groupMembers).set({ role: 'admin' }).where(member(to));
    await tx.update(schema.groupMembers).set({ role: 'member' }).where(member(from));
  });
  return 'handed_over';
}

/** `db.execute` hands back an array on one driver and `{ rows }` on another. */
function rowsOf(result: unknown): unknown[] {
  return Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
}
