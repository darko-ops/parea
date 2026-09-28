/**
 * Moments: one photograph somebody put in front of their people.
 *
 * A roll is everyone's pictures of one evening. A moment is the other shape —
 * one person, one picture, no evening — and Home draws them as a row of
 * squares, one per person, each wearing that person's face. Pressing one opens
 * their moments in the same viewer a roll's photograph opens in, and stepping
 * past the last carries on into the next person's.
 *
 * ## Who sees one
 *
 * The people who would already see this person's face in the product: their
 * friends, and anybody they are in a roll with. Nothing wider. A moment has no
 * link to share and no page a stranger can land on, and a block hides it in
 * both directions the way a block hides everything else.
 *
 * ## How long
 *
 * `MOMENT_DAYS`. A moment is "front and center", and a row that still leads
 * with somebody's picture from last spring is a row that has stopped meaning
 * anything. Nothing is deleted when it ages out — it is only no longer drawn.
 */

import { schema } from '@parea/core';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import { type Db, getDb } from './db';
import { getStorage } from './storage';

/** How long a moment stays in the row. */
export const MOMENT_DAYS = 30;

/** The largest original accepted. A generous phone photograph. */
export const MOMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Where an original waits between the phone's PUT and `/api/moments` reading
 * it. Per actor, so the key a client hands back can be checked as theirs by
 * its prefix alone.
 */
export function incomingPrefix(actorId: string): string {
  return `moments/incoming/${actorId}/`;
}

/** How many people the row holds, and how many moments each. */
export const MOMENT_PEOPLE_LIMIT = 30;
export const MOMENTS_PER_PERSON = 12;

export type Moment = {
  id: string;
  key: string;
  width: number;
  height: number;
  createdAt: string;
};

export type MomentPerson = {
  actorId: string;
  handle: string | null;
  name: string;
  avatarKey: string | null;
  /** The viewer's own. Drawn first, and the only ones they can remove. */
  mine: boolean;
  /** Newest first. */
  moments: Moment[];
};

/**
 * Everyone with a moment this viewer may see, yours first, then the most
 * recently posted.
 */
export async function momentsFor(db: Db, viewer: string | null): Promise<MomentPerson[]> {
  if (!viewer) return [];

  const rows = await db.execute(sql`
    with audience as (
      select ${viewer}::uuid as id
      union
      select f.friend_actor_id from "friendship" f where f.actor_id = ${viewer}
      union
      select theirs.actor_id
        from "event_participant" mine
        join "event" e on e.id = mine.event_id and e.deleted_at is null
        join "event_participant" theirs on theirs.event_id = e.id
       where mine.actor_id = ${viewer}
    ),
    ranked as (
      select m.id, m.actor_id, m.key, m.width, m.height, m.created_at,
             row_number() over (partition by m.actor_id order by m.created_at desc) as n
        from "moment" m
        join audience au on au.id = m.actor_id
       where m.deleted_at is null
         and m.created_at > now() - make_interval(days => ${MOMENT_DAYS})
    )
    select r.id, r.actor_id as "actorId", r.key, r.width, r.height,
           r.created_at as "createdAt",
           a.handle,
           coalesce(nullif(btrim(a.display_name), ''), '@' || a.handle, 'Someone') as name,
           a.avatar_key as "avatarKey"
      from ranked r
      join "actor" a on a.id = r.actor_id and a.merged_into_id is null
     where r.n <= ${MOMENTS_PER_PERSON}
       and not exists (
         select 1 from "block" b
          where (b.blocker_actor_id = ${viewer} and b.blocked_actor_id = r.actor_id)
             or (b.blocker_actor_id = r.actor_id and b.blocked_actor_id = ${viewer})
       )
     order by r.created_at desc
  `);

  // PGlite answers `{rows}` and postgres.js answers an array. The same shape every raw query here handles.
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as {
    id: string;
    actorId: string;
    key: string;
    width: number;
    height: number;
    createdAt: Date | string;
    handle: string | null;
    name: string;
    avatarKey: string | null;
  }[];

  // Rows arrive newest first overall, so the first row seen for each person is
  // their newest and the order people are first seen in is the row's order.
  const people = new Map<string, MomentPerson>();
  for (const row of list) {
    let person = people.get(row.actorId);
    if (!person) {
      if (people.size >= MOMENT_PEOPLE_LIMIT) continue;
      person = {
        actorId: row.actorId,
        handle: row.handle,
        name: row.name,
        avatarKey: row.avatarKey,
        mine: row.actorId === viewer,
        moments: [],
      };
      people.set(row.actorId, person);
    }
    person.moments.push({
      id: row.id,
      key: row.key,
      width: Number(row.width),
      height: Number(row.height),
      createdAt: new Date(row.createdAt).toISOString(),
    });
  }

  const all = [...people.values()];
  return [...all.filter((p) => p.mine), ...all.filter((p) => !p.mine)];
}

/** Takes one back. Only its author can; anybody else gets `false`. */
export async function removeMoment(
  db: Db,
  actorId: string,
  momentId: string,
): Promise<{ key: string } | null> {
  const [row] = await db
    .update(schema.moments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.moments.id, momentId),
        eq(schema.moments.actorId, actorId),
        isNull(schema.moments.deletedAt),
      ),
    )
    .returning({ key: schema.moments.key });
  return row ?? null;
}

export type MomentsResponse = {
  people: {
    actorId: string;
    handle: string | null;
    name: string;
    avatar: string | null;
    mine: boolean;
    moments: {
      id: string;
      src: string;
      width: number;
      height: number;
      createdAt: string;
    }[];
  }[];
};

/** Presigned here: the storage key never crosses this boundary. */
export async function momentsResponse(actorId: string | null): Promise<MomentsResponse> {
  const people = await momentsFor(getDb(), actorId);
  const storage = getStorage();
  const out = {
    people: await Promise.all(
      people.map(async (person) => ({
        actorId: person.actorId,
        handle: person.handle,
        name: person.name,
        avatar: await avatarUrl(person.avatarKey),
        mine: person.mine,
        moments: (
          await Promise.all(
            person.moments.map(async (moment) => {
              const src = await storage.presignGet(moment.key, 3600).catch(() => null);
              return src
                ? {
                    id: moment.id,
                    src,
                    width: moment.width,
                    height: moment.height,
                    createdAt: moment.createdAt,
                  }
                : null;
            }),
          )
        ).filter((m) => m !== null),
      })),
    ),
  };
  // A person whose every picture failed to sign has nothing to open.
  return { people: out.people.filter((person) => person.moments.length > 0) };
}
