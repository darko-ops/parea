/**
 * Moments: who sees one, in what order, and who can take one back.
 *
 * The audience is the part worth pinning. A moment has no link and no page a
 * stranger can reach, so the one query that decides who sees it is the whole
 * of its privacy — friends, and nobody else.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
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
  canSeeMoment,
  commentOnMoment,
  removeMomentComment,
  toggleMomentReaction,
  markSeen,
  momentStream,
  orderStream,
  removeMoment,
  replyInChat,
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
    truncate "account", "actor", "block", "friendship", "event", "moment", "groups",
      "group_message"
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
  it('shows friends, and nobody else', async () => {
    /*
     * Roll-mates and group-mates used to see moments too. A roll's participant
     * row is written for opening its link, so one forwarded public album put a
     * stranger in front of everyone's day; a friendship is the one connection
     * both people chose.
     */
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

    expect(await who(me)).toEqual(['friend']);
    // And the other way: the roll-mate and group-mate do not see mine.
    await moment(me);
    expect(await who(rollmate)).toEqual(['rollmate']);
    expect(await who(groupmate)).toEqual(['groupmate']);
  });

  it('shows a friend whatever else the two of you share', async () => {
    const me = await person('me');
    const them = await person('them');
    await befriend(db, me, them);
    await rollWith(me, them);
    await groupWith(me, them);
    await moment(them);

    expect(await who(me)).toEqual(['them']);
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

describe('reacting and commenting', () => {
  it('is for people who can see the moment, and comes back with the stream', async () => {
    const me = await person('me');
    const friend = await person('friend');
    const stranger = await person('stranger');
    await befriend(db, me, friend);
    const id = await moment(me);

    expect(await canSeeMoment(db, friend, id)).toBe(true);
    expect(await canSeeMoment(db, stranger, id)).toBe(false);

    await commentOnMoment(db, friend, id, 'love this');
    expect(await toggleMomentReaction(db, friend, id, '🔥')).toBe('added');

    const [mine] = (await momentStream(db, me)).filter((m) => m.id === id);
    expect(mine).toBeTruthy();
  });

  it('toggles a reaction off again, and lets only the author delete a comment', async () => {
    const me = await person('me');
    const friend = await person('friend');
    await befriend(db, me, friend);
    const id = await moment(me);

    expect(await toggleMomentReaction(db, friend, id, '❤️')).toBe('added');
    expect(await toggleMomentReaction(db, friend, id, '❤️')).toBe('removed');

    const comment = await commentOnMoment(db, friend, id, 'hi');
    expect(await removeMomentComment(db, me, comment)).toBe(false);
    expect(await removeMomentComment(db, friend, comment)).toBe(true);
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
    expect(view).toMatch(/const MOMENT_SECONDS = 15;/);
    // Held while the ⋯ menu, the reaction picker or a comment is in use, or
    // the tab is hidden.
    expect(view).toMatch(/document\.hidden \|\| document\.querySelector\('\[role="menu"\], \[data-holding\]'\) !== null;/);
    // Then the next one, or back where it was opened from after the last.
    expect(view).toMatch(/location\.assign\(next \? href\(next\.id\) : home\);/);
    // The line and the strip are at the foot, after the picture.
    expect(view.indexOf('className="photo-body"')).toBeLessThan(view.indexOf('className="moment-nav-wrap"'));
    expect(view).toMatch(/className="moment-time-fill"/);
    // At the foot: the strip, then the line, then the buttons, then comments.
    const strip = view.indexOf('<MomentStrip');
    const line = view.indexOf('className="moment-time"');
    const verbs = view.indexOf('className="photo-verbs"');
    const talk = view.indexOf('<MomentComments');
    expect(strip).toBeLessThan(line);
    expect(line).toBeLessThan(verbs);
    expect(verbs).toBeLessThan(talk);
    expect(view).toMatch(/endpoint=\{`\/api\/moments\/\$\{moment\.id\}\/reactions`\}/);
  });
});

describe('telling the author', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8');

  it('says it in their chat — only when a reaction goes on — and the push points there', () => {
    const comments = stripComments(read('api/moments/[id]/comments/route.ts'));
    expect(comments).toMatch(/const reply = await replyInChat\(db, actorId, id, \{ body: text \}\);/);
    expect(comments).toMatch(/if \(reply\) \{[\s\S]*?notifyMomentComment\(db, \{ toActorId: reply\.toActorId, groupId: reply\.groupId/);

    const reactions = stripComments(read('api/moments/[id]/reactions/route.ts'));
    expect(reactions).toMatch(/if \(state === 'added'\) \{[\s\S]*?replyInChat\(db, actorId, id, \{ body: emoji, emoji \}\)/);
  });
});

describe('an answer in the chat', () => {
  it('lands in the two people’s chat, made once and used after', async () => {
    const me = await person('me');
    const friend = await person('friend');
    await befriend(db, me, friend);
    const id = await moment(me);

    const first = await replyInChat(db, friend, id, { body: 'love it' });
    const second = await replyInChat(db, friend, id, { body: '🔥', emoji: '🔥' });
    expect(first?.toActorId).toBe(me);
    expect(second?.groupId).toBe(first?.groupId);

    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, first!.groupId));
    expect(members.map((m) => m.actorId).sort()).toEqual([me, friend].sort());

    const said = await db
      .select()
      .from(schema.groupMessages)
      .where(eq(schema.groupMessages.groupId, first!.groupId));
    expect(said.map((m) => [m.body, m.momentId, m.momentEmoji])).toEqual([
      ['love it', id, null],
      ['🔥', id, '🔥'],
    ]);
  });

  it('is nothing when the author answers their own moment', async () => {
    const me = await person('me');
    const id = await moment(me);
    expect(await replyInChat(db, me, id, { body: 'mine' })).toBeNull();
  });
});


describe('in the chat', () => {
  it('draws the moment beside its answer, and says when it has ended', () => {
    const thread = readFileSync(
      fileURLToPath(new URL('../app/components/Thread.tsx', import.meta.url)),
      'utf8',
    );
    expect(thread).toMatch(/href=\{`\/moments\/\$\{message\.moment\.id\}`\}/);
    expect(thread).toMatch(/if \(!moment\.thumb\) return `\$\{verb\} a moment that has ended`;/);
    expect(thread).toMatch(/return `\$\{verb\} \$\{moment\.mine \? 'your' : 'their'\} moment`;/);
  });
});
