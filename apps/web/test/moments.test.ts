/**
 * Moments: who sees one, in what order, and who can take one back.
 *
 * The audience is the part worth pinning. A moment has no link and no page a
 * stranger can reach, so the one query that decides who sees it is the whole
 * of its privacy — friends, people you are in a roll with, and nobody else.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { befriend } from '@/friends';
import {
  BOOST_CAP_MINUTES,
  MOMENT_HOURS,
  markSeen,
  momentStream,
  orderStream,
  removeMoment,
} from '@/moments';

import { stripComments } from './support/source';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "friendship", "event", "moment", "groups"
    restart identity cascade
  `);
});

async function person(handle: string) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', handle, displayName: handle })
    .returning();
  return actor!.id;
}

async function moment(actorId: string, at = new Date()) {
  const [row] = await db
    .insert(schema.moments)
    .values({ actorId, key: `moments/${actorId}/x.jpg`, width: 10, height: 10, createdAt: at })
    .returning();
  return row!.id;
}

async function rollWith(...actors: string[]) {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actors[0]! })
    .returning();
  await db
    .insert(schema.eventParticipants)
    .values(actors.map((actorId) => ({ eventId: event!.id, actorId })));
  return event!.id;
}

async function groupWith(...actors: string[]) {
  const [group] = await db
    .insert(schema.groups)
    .values({ name: 'Crew', slug: `crew-${Math.random().toString(36).slice(2)}` })
    .returning();
  await db
    .insert(schema.groupMembers)
    .values(actors.map((actorId) => ({ groupId: group!.id, actorId })));
}

/** Whose moments the viewer's stream holds, in stream order. */
const who = async (viewer: string) =>
  (await momentStream(db, viewer)).map((m) => m.author.handle);

const MINUTE = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE);


describe('who sees a moment', () => {
  it('shows friends, roll-mates and group-mates, and not strangers', async () => {
    const me = await person('me');
    const friend = await person('friend');
    const rollmate = await person('rollmate');
    const groupmate = await person('groupmate');
    const stranger = await person('stranger');
    await befriend(db, me, friend);
    await rollWith(me, rollmate);
    await groupWith(me, groupmate);
    await moment(friend);
    await moment(rollmate);
    await moment(groupmate);
    await moment(stranger);

    expect((await who(me)).sort()).toEqual(['friend', 'groupmate', 'rollmate']);
  });

  it('stops showing a roll-mate once the roll is deleted', async () => {
    const me = await person('me');
    const them = await person('them');
    const roll = await rollWith(me, them);
    await moment(them);
    await db.execute(sql`update "event" set deleted_at = now() where id = ${roll}`);

    expect(await who(me)).toEqual([]);
  });

  it('hides it in both directions once either has blocked the other', async () => {
    const me = await person('me');
    const them = await person('them');
    await befriend(db, me, them);
    await moment(me);
    await moment(them);
    await db.insert(schema.blocks).values({ blockerActorId: them, blockedActorId: me });

    expect(await who(me)).toEqual(['me']);
    expect(await who(them)).toEqual(['them']);
  });

  it('shows nothing to somebody with no actor', async () => {
    expect(await momentStream(db, null)).toEqual([]);
  });

  it(`lasts ${MOMENT_HOURS} hours and no longer`, async () => {
    const me = await person('me');
    const a = await person('a');
    await befriend(db, me, a);
    await moment(a, ago(MOMENT_HOURS * 60 - 5));
    await moment(a, ago(MOMENT_HOURS * 60 + 5));

    // The one posted just inside the day is shown; the one just past it is
    // gone — from the stream and from the person's page alike.
    expect(await who(me)).toEqual(['a']);
    expect(await momentStream(db, me, { by: a })).toHaveLength(1);
  });
});

describe('the stream', () => {
  it('is one list of everybody’s moments, not one entry per person', async () => {
    const me = await person('me');
    const a = await person('a');
    await befriend(db, me, a);
    await moment(a, ago(3));
    await moment(a, ago(2));
    await moment(me, ago(1));

    // Yours counts as seen, so it follows the two you have not opened.
    expect(await who(me)).toEqual(['a', 'a', 'me']);
  });

  it('lets an opened moment fall behind the ones you have not seen', async () => {
    const me = await person('me');
    const a = await person('a');
    await befriend(db, me, a);
    const older = await moment(a, ago(5));
    const newer = await moment(a, ago(1));
    await markSeen(db, me, newer);

    const order = (await momentStream(db, me)).map((m) => m.id);
    expect(order).toEqual([older, newer]);
  });

  it('holds the order still for openings after `seenBefore`', async () => {
    // The web steps through a page at a time and marks each as it goes.
    const me = await person('me');
    const a = await person('a');
    await befriend(db, me, a);
    const older = await moment(a, ago(5));
    const newer = await moment(a, ago(1));
    const before = new Date(Date.now() - 1000);
    await markSeen(db, me, newer);

    const order = (await momentStream(db, me, { seenBefore: before })).map((m) => m.id);
    expect(order).toEqual([newer, older]);
  });

  it('narrows to one person, newest first, for their page', async () => {
    const me = await person('me');
    const a = await person('a');
    const b = await person('b');
    await befriend(db, me, a);
    await befriend(db, me, b);
    const first = await moment(a, ago(9));
    await moment(b, ago(5));
    const second = await moment(a, ago(1));

    const theirs = (await momentStream(db, me, { by: a })).map((m) => m.id);
    expect(theirs).toEqual([second, first]);
  });
});

describe('the order', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const at = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);
  const none = { friend: false, roll: false, group: false };
  const close = { friend: true, roll: true, group: true };
  const item = (name: string, minutes: number, extra: Partial<{ seen: boolean; close: typeof none }> = {}) => ({
    name,
    createdAt: at(minutes),
    seen: extra.seen ?? false,
    close: extra.close ?? none,
  });
  const names = (list: { name: string }[]) => list.map((m) => m.name);

  it('is newest first when nobody is closer than anybody else', () => {
    expect(names(orderStream([item('old', 30), item('new', 2), item('mid', 10)]))).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('lets closeness settle a near tie, and no more than that', () => {
    // A close friend's moment from 8 minutes ago beats a stranger's from 2 —
    // the lift is capped at ten minutes of apparent recency.
    expect(
      names(orderStream([item('stranger', 2), item('friend', 8, { close })])),
    ).toEqual(['friend', 'stranger']);
    // It never lifts something older than the cap above something new.
    expect(
      names(
        orderStream([item('stranger', 2), item('friend', 2 + BOOST_CAP_MINUTES + 1, { close })]),
      ),
    ).toEqual(['stranger', 'friend']);
  });

  it('puts what you have not opened before what you have', () => {
    expect(
      names(orderStream([item('seen', 1, { seen: true }), item('unseen', 20)])),
    ).toEqual(['unseen', 'seen']);
  });
});

describe('taking one back', () => {
  it('is its author’s alone', async () => {
    const me = await person('me');
    const them = await person('them');
    const id = await moment(me);

    expect(await removeMoment(db, them, id)).toBeNull();
    expect(await removeMoment(db, me, id)).not.toBeNull();
    expect(await who(me)).toEqual([]);
  });
});

describe('adding one', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8');

  it('goes to its own page from the sheet, and only Share there sends', () => {
    // The sheet used to fire a file dialog and upload whatever came back, with
    // nothing on the screen between choosing and sharing.
    expect(read('components/CreateMenu.tsx')).toMatch(/href="\/moments\/new"/);
    expect(read('components/CreateMenu.tsx')).not.toMatch(/api\/moments/);
    const add = read('components/AddMoment.tsx');
    expect(add).toMatch(/disabled=\{!file \|\| busy\}/);
    // Straight to storage, then the key: the origin cannot take a phone
    // photograph as a request body.
    expect(add).toMatch(/fetch\('\/api\/moments\/uploads'/);
    expect(add).toMatch(/JSON\.stringify\(\{ key \}\)/);
  });
});

describe('the ring', () => {
  it('is the app icon’s field, stop for stop with the phone’s', () => {
    /*
     * Every colour and opacity in the web ring's gradients has to be one of
     * `IconField`'s, and all of them have to be there — the phone and the page
     * are one product, and two copies of a palette drift the first time
     * somebody edits one of them.
     */
    const phone = readFileSync(
      fileURLToPath(new URL('../../mobile/src/IconField.tsx', import.meta.url)),
      'utf8',
    );
    const css = readFileSync(
      fileURLToPath(new URL('../app/globals.css', import.meta.url)),
      'utf8',
    );
    const ring = css.slice(css.indexOf('.moment-ring {'), css.indexOf('.moment-shot {'));
    const hex = (h: string) =>
      [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
    const stops = [...phone.matchAll(/\[([\d.]+), '(#[0-9A-F]{6})', ([\d.]+)\]/g)];
    expect(stops).toHaveLength(23);
    for (const [, , colour, opacity] of stops) {
      expect(ring).toContain(`rgba(${hex(colour!)}, ${Number(opacity)})`);
    }
    expect(ring).toContain("#173EA8");
    expect(phone).toContain("const GLASS_BASE = '#173EA8';");
  });
});


describe('on Home, one way in', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8');

  it('is a single bar with a count, and no names or pictures', () => {
    const home = read('components/HomeView.tsx');
    expect(home).toMatch(/<MomentsBar moments=\{moments\} at=\{momentsAt\} \/>/);
    expect(home).not.toMatch(/<MomentStrip/);

    const bar = stripComments(read('components/MomentsBar.tsx'));
    expect(bar).toMatch(/\{unseen\.length\} new/);
    // Nobody's identity and no preview: the bar never touches an author or a
    // picture, and never draws one element per moment.
    expect(bar).not.toMatch(/author|avatar|thumb|src=|<img|Face/);
    expect(bar).not.toMatch(/moments\.map\(/);
    // It opens on the first one you have not seen.
    expect(bar).toMatch(/const start = unseen\[0\] \?\? moments\[0\]!/);
  });

  it('shows colour through frosted glass, brighter while something is new', () => {
    const bar = stripComments(read('components/MomentsBar.tsx'));
    expect(bar).toMatch(/<span className="moments-bar-bloom" aria-hidden="true" \/>/);
    // The status on the right, and the chevron after it.
    expect(bar).toMatch(/moments-bar-count">\{unseen\.length\} new<\/span>\}\s*<span className="moments-bar-go"/);

    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
    const rules = css.slice(css.indexOf('.moments-bar {'), css.indexOf('.moment-nav-wrap'));
    expect(rules).toMatch(/\.moments-bar::after \{[^}]*backdrop-filter: blur/);
    // Faint and still when caught up; bright and drifting when new.
    expect(rules).toMatch(/\.moments-bar-bloom \{[^}]*opacity: 0\.4;/);
    // A light card on the white page, with dark text.
    expect(rules).toMatch(/\.moments-bar \{[^}]*background: #f7f7fa; color: var\(--fg\)/);
    expect(rules).toMatch(/\.moments-bar-new \.moments-bar-bloom \{\s*opacity: 1;\s*animation: moments-drift/);
    // The drift is off for anybody who has asked for less motion.
    expect(rules).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.moments-bar-new \.moments-bar-bloom \{ animation: none; \}/);
  });

  it('puts the tiles inside the viewer, as its map', () => {
    const view = read('components/MomentView.tsx');
    expect(view).toMatch(/<MomentStrip[\s\S]*?current=\{moment\.id\}/);
    // Profiles keep their strip as it was.
    expect(read('components/PersonView.tsx')).toMatch(/<MomentStrip/);
    expect(read('components/AccountView.tsx')).toMatch(/<MomentStrip/);
  });
});

describe('the viewer', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8');

  it('gives each moment twenty seconds, shows the time going, and walks on', () => {
    const view = stripComments(read('components/MomentView.tsx'));
    expect(view).toMatch(/const MOMENT_SECONDS = 20;/);
    // Held while the ⋯ menu is open or the tab is hidden.
    expect(view).toMatch(/const held = document\.hidden \|\| document\.querySelector\('\[role="menu"\]'\) !== null;/);
    // Then the next one, or back where it was opened from after the last.
    expect(view).toMatch(/location\.assign\(next \? href\(next\.id\) : home\);/);
    // The line and the strip are at the foot, after the picture.
    expect(view.indexOf('className="photo-body"')).toBeLessThan(view.indexOf('className="moment-nav-wrap"'));
    expect(view).toMatch(/className="moment-time-fill"/);
  });
});

