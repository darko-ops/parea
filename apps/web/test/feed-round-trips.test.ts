/**
 * How many times the album asks the database before it can answer.
 *
 * The queries here are not slow; the distance is. Measured from a developer
 * machine against the hosted database, a single trivial `select … limit 1`
 * takes about 100ms, essentially all of it network. So the thing worth guarding
 * is not how much work each query does but how many of them wait on each other:
 * the feed route once had eighteen `await`s in a row and took the better part
 * of two seconds to say anything.
 *
 * These are source checks, and that is a deliberate choice rather than a
 * shortcut. A timing assertion against a database in another region is a flaky
 * test that fails on somebody's train wifi; the shape is what actually decays,
 * and the shape is what this pins. A future edit that reintroduces a serial
 * `await` in the fan-out will fail here rather than in a bug report about the
 * app feeling slow.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const FEED = read('app/api/events/[id]/photos/route.ts');
const MEMBERS = read('src/members.ts');
const MESSAGES = read('src/messages.ts');

/** The fan-out: everything between the batch opening and its closing bracket. */
const BATCH = FEED.slice(
  // After the opening line, whose own `await` is the one that is supposed to
  // be there — it is what the whole batch resolves on.
  FEED.indexOf('] = await Promise.all([') + '] = await Promise.all(['.length,
  FEED.indexOf('  const contributors ='),
);

describe('the feed asks for everything at once', () => {
  it('fans out rather than queueing', () => {
    // Each of these needs only the event and the viewer, both known by then.
    for (const call of [
      'photosWithCard(db, photoIds)',
      'reactionsForPhotos(db, photoIds, viewerId)',
      'contributorsOf(db, event.id, rows, viewerId)',
      'messagesFor(db, event.id, viewerId,',
      "decide(db, event, 'administer', requester)",
      "decide(db, event, 'contribute', requester)",
      'membersOf(db, event.id, event.createdBy)',
      'invitedTo(db, event.id)',
      'currentAccountActorId()',
    ]) {
      expect(BATCH, `${call} left out of the batch`).toContain(call);
    }
  });

  it('has no `await` inside the fan-out', () => {
    /*
     * One `await` in there and everything after it queues behind it, which is
     * the bug this batch exists to fix — and it would look perfectly ordinary
     * in review.
     */
    expect(BATCH).not.toMatch(/\bawait\b/);
  });

  it('fetches the members once, not twice', () => {
    /*
     * `rosterFor` calls `membersOf` itself, so asking for both was the same
     * query twice — once for the `members` field and again inside the roster.
     * The route now fetches each half once and assembles them with no database
     * in it.
     */
    expect(FEED).not.toMatch(/rosterFor\(/);
    expect(FEED).toMatch(/rosterFrom\(members, invited, photoCounts\(rows\)\)/);
    expect(FEED.match(/membersOf\(/g) ?? []).toHaveLength(1);
  });

  it('hands `membersOf` the creator it already has', () => {
    // Without it, `membersOf` reads the event again purely to find out which
    // row is the host — a whole round trip for one column this route holds.
    expect(FEED).toMatch(/membersOf\(db, event\.id, event\.createdBy\)/);
  });

  it('keeps the two that genuinely cannot join', () => {
    // `waiting` needs `canAdminister` to have come back; the photo URLs need
    // `hasCard` and `reactions`. Both stay in order, deliberately.
    expect(FEED).toMatch(/const canAdminister = adminDecision\.allow/);
    expect(FEED).toMatch(/const \[waitingRow\] = canAdminister/);
  });
});

describe('the helpers do not queue inside themselves', () => {
  it('membersOf reads the host and the rows together', () => {
    expect(MEMBERS).toMatch(/const \[host, rows\] = await Promise\.all\(\[/);
  });

  it('rosterFor reads its two halves together', () => {
    expect(MEMBERS).toMatch(
      /const \[members, invited\] = await Promise\.all\(\[\s*membersOf\(db, eventId\),\s*invitedTo\(db, eventId\),/,
    );
  });

  it('assembling a roster touches no database at all', () => {
    // `rosterFrom` is what lets a caller holding both halves skip the fetch.
    const fn = MEMBERS.slice(MEMBERS.indexOf('export function rosterFrom'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).not.toMatch(/\bawait\b|\bdb\b/);
  });

  it('messagesFor starts the reactions before the thread returns', () => {
    /*
     * It used to look reactions up by message id, which cannot begin until the
     * messages are back. Scoped through the event instead, the question needs
     * nothing from the first query and the two overlap — the same rows either
     * way, because every reaction on this thread is on one of those messages.
     */
    expect(MESSAGES).toMatch(/const reactionRows = db\s*\n\s*\.select\(/);
    expect(MESSAGES).toMatch(/const reactions = await reactionRows;/);
    // Started before the messages query, not after it.
    expect(MESSAGES.indexOf('const reactionRows = db')).toBeLessThan(
      MESSAGES.indexOf('const rows = await db'),
    );
  });

  it('still drops reactions on messages the viewer cannot see', () => {
    // The wider query returns every reaction on the event. The tally is built
    // from it but only ever read for `rows`, which is the blocked-filtered
    // list — so a blocked person's reaction is fetched and never surfaced.
    expect(MESSAGES).toMatch(/byMessage\.get\(row\.id\)/);
  });
});
