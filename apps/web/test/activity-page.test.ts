/**
 * The shape of Lately, and the two rules it is easy to undo.
 *
 * Both of them look like bugs when you meet them in isolation, which is why
 * they need writing down rather than trusting.
 *
 * **Nothing waiting draws nothing.** The page used to show a full-width accent
 * bar reading "0 invites", and the argument for it is in the git history and is
 * not silly: a count that only appears when non-zero teaches people to scan for
 * its absence, and absence is also what a broken query looks like. It was
 * reversed because the price is the loudest object on the page being an
 * announcement of nothing, on most loads, forever. Somebody meeting an empty
 * `Waiting on you` section will reasonably think it is missing.
 *
 * **The boundary is read before it is moved.** Rendering this page marks
 * everything seen. Ask for the boundary after that and it is this render's own
 * timestamp, so nothing is ever new — the unread fill would be correct exactly
 * once, for somebody who never came back. Nothing fails; the page just quietly
 * stops marking anything.
 *
 * Source checks because there is no DOM in this suite. They stand in for the
 * browser run that confirmed the page, and they catch it being taken apart.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const read = async (path: string) =>
  stripComments(await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const PAGE = await read('../app/activity/page.tsx');
const WAITING = await read('../app/components/PendingRequests.tsx');
const LIST = await read('../app/components/ActivityList.tsx');
const ACTIVITY = await read('../src/activity.ts');
/* The wording moved out of the page when the phone started drawing the same
   feed: one implementation of "is this today?", for both clients. */
const WHEN = await read('../src/when.ts');
const ROUTE = await read('../app/api/activity/route.ts');
/* Comments stripped: every claim about the rows below is about what a browser
   does, and a browser does not read the prose. */
const RULES = await read('../app/globals.css');

describe('what is waiting on you', () => {
  it('is answerable where it is, not behind a click', () => {
    /*
     * The collapse is the thing being defended against. It put the one part of
     * this page that needs a person behind a disclosure, so the number had to
     * be opened before it meant anything — and a number is not an answer to
     * "is there anything for me to do", it is a promise that there might be.
     */
    expect(WAITING).not.toMatch(/expanded|aria-expanded|aria-controls/);
    expect(WAITING).toMatch(/yesLabel/);
    expect(WAITING).toMatch(/noLabel/);
  });

  it('draws nothing at all when there is nothing', () => {
    // Not a heading with an empty list under it, and not a zero. The feed
    // simply starts the page.
    expect(WAITING).toMatch(/open\.length === 0\) return null/);
  });

  it('keeps the per-kind wording, which is not decoration', () => {
    // "Let in" rather than "Accept": that one is a door being opened onto
    // photographs of an evening, and the word for that is not the word for
    // agreeing to something.
    expect(WAITING).toContain("yesLabel: 'Let in'");
    expect(WAITING).toContain("noLabel: 'Not now'");
    expect(WAITING).toContain("yesLabel: 'Accept'");
    expect(WAITING).toContain("noLabel: 'Decline'");
  });

  it('puts a card back when the answer did not send', () => {
    // Optimistic in one direction only. A list that quietly does not change is
    // worse than one that changes and changes back.
    expect(WAITING).toMatch(/setOpen\(before\)/);
    expect(WAITING).toMatch(/setError\(/);
  });

  it('stays on the page when an invitation is accepted', () => {
    /*
     * It used to go straight into the event, on the reasoning that accepting
     * is the one answer that changes what is reachable and the place to
     * rebuild the page is the thing that just opened. Both halves are true and
     * the move was still wrong: somebody with three invitations was carried
     * off by the first and had to come back for the other two.
     *
     * The refresh is what replaces it. The server has already written the
     * participant row and the capability, so rebuilding this page puts the
     * album on Home and "You joined <name>" in the feed below, with a link.
     */
    expect(WAITING).toMatch(/kind === 'invite'\) router\.refresh\(\)/);
    expect(WAITING).not.toMatch(/window\.location\.href = `\/event\//);
  });
});

describe('reading the boundary', () => {
  it('happens before the render moves it', () => {
    const readAt = PAGE.indexOf('invitesSeenAtFor');
    const markAt = PAGE.indexOf('await markInvitesSeen');
    expect(readAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(markAt);
  });

  it('treats never-looked as everything being new', () => {
    // Comparing against null returns false in JavaScript and null in SQL, and
    // both are the wrong answer in the quiet direction: a brand-new account
    // would see its whole first page as already read.
    expect(PAGE).toMatch(/since === null \|\| item\.at > since/);
  });
});

describe('the day headings', () => {
  it('are decided on the server, with the relative times', () => {
    /*
     * A boundary worked out in the browser can disagree with the one the HTML
     * was rendered against: a page loaded at 23:59 and hydrated at 00:00 finds
     * its "Today" heading has become "Yesterday", and React answers a text
     * mismatch by throwing the tree away.
     *
     * The phone has a second reason, and a better one: a device's clock is a
     * setting. A phone in the wrong timezone would draw a feed whose headings
     * disagree with the one the same person saw in a browser ten minutes
     * earlier.
     */
    expect(WHEN).toMatch(/export function bucketFor/);
    expect(PAGE).toMatch(/bucket: bucketFor\(item\.at, now\)/);
    expect(LIST).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });

  it('are worded by one implementation, for both clients', () => {
    /*
     * They were in the page, which was right while the page was the only
     * reader. Two copies of "is this today?" is two answers to a question that
     * has to have one — and the phone's copy would be the one nobody notices
     * drifting, because nothing renders both side by side.
     */
    expect(PAGE).toMatch(/import \{ ago, bucketFor \} from '@\/when'/);
    expect(ROUTE).toMatch(/import \{ ago, bucketFor \} from '@\/when'/);
    expect(PAGE).not.toMatch(/function bucketFor|function ago/);
    expect(ROUTE).not.toMatch(/function bucketFor|function ago/);
  });

  it('are calendar days, not twenty-four-hour windows', () => {
    // 9am today and 11pm last night are fourteen hours apart and belong under
    // different words. That is the entire point of the headings.
    expect(WHEN).toMatch(/getFullYear\(\), \w+\.getMonth\(\), \w+\.getDate\(\)/);
  });

  it('are regrouped from the rows, so hiding the last one takes the heading', () => {
    // A heading handed down as a row would sit there over nothing the moment
    // somebody dismissed the only line under it.
    expect(LIST).toMatch(/groupByDay\(rows\)/);
  });
});

describe('the feed', () => {
  it('shows the photographs a row is counting, on that kind only', () => {
    // Three thumbnails turn "Maya added 12 photos" from a notification you have
    // to open to evaluate into one you can act on. On every kind it would make
    // the list scan as two lists.
    expect(LIST).toMatch(/row\.images\.length > 0/);
    expect(LIST).toMatch(/activity-strip/);
  });

  it('keeps the strip out of the way of the sentence', () => {
    // The row is one link to the event, not four, and three thumbnails
    // announcing themselves before the sentence is three things read out
    // before the thing that says what happened.
    const strip = LIST.match(/<span className="activity-strip"[^>]*>/)?.[0] ?? '';
    expect(strip).toContain('aria-hidden');
    expect(LIST).toMatch(/aria-label=\{`\$\{row\.who\} \$\{row\.what\}`\}/);
  });

  it('leaves the empty case to the list it is a list of', () => {
    /*
     * The page drew its own welcome for one commit, which is why the phone had
     * none: it reads this feed through `/api/activity`, and a row that exists
     * in a page component exists for one client. It is an `ActivityItem` built
     * by `activityFor` now — see `activity.test.ts`, where every property that
     * makes it honest is asserted against a database.
     *
     * What is left here is the absence: no second welcome drawn on top, and no
     * paragraph about having nothing, because the list is never empty for
     * somebody who has not hidden one.
     */
    expect(PAGE).not.toMatch(/<Welcome/);
    expect(LIST).not.toMatch(/Nothing yet\./);
    expect(ACTIVITY).toMatch(/kind: 'welcome'/);
  });

  it('puts a row back when hiding it did not send', () => {
    expect(LIST).toMatch(/setRows\(before\)/);
    expect(LIST).toMatch(/'\/api\/activity\/hidden'/);
    expect(LIST).toMatch(/key: row\.id/);
  });
});

/**
 * The same page, for the client that cannot compose it on the server.
 *
 * The web reads `activityFor` and `pendingRequestsFor` in its render; the phone
 * has to ask. `GET /api/activity` is that page's data, and what matters is that
 * it stays the *same* page — the words, the boundary that decides what is new,
 * and the fact that looking is what clears the badge.
 */
describe('the route the phone reads', () => {
  it('answers both halves in one request', () => {
    /*
     * Lately is both at once. Two round trips to draw one screen means the
     * answerable cards and the feed under them arrive separately, so the screen
     * lays itself out twice — and on a phone the second trip is the one that
     * happens on a train.
     */
    expect(ROUTE).toMatch(/activityFor\(db, actorId\)/);
    expect(ROUTE).toMatch(/pendingRequestsFor\(db, actorId\)/);
    expect(ROUTE).toMatch(/waiting:/);
    expect(ROUTE).toMatch(/items:/);
  });

  it('words the times and the buckets on this side', () => {
    expect(ROUTE).toMatch(/when: ago\(item\.at, now\)/);
    expect(ROUTE).toMatch(/bucket: bucketFor\(item\.at, now\)/);
    // The cards carry one too: "asked you into Tom & Ruth's wedding · 2 hours
    // ago" is one sentence and half of it would otherwise be the phone's.
    expect(ROUTE).toMatch(/when: ago\(request\.at, now\)/);
  });

  it('reads the boundary before it moves it', () => {
    /*
     * `markInvitesSeen` moves `invites_seen_at`. Asking for it afterwards
     * returns the moment of this request and marks every line as already read,
     * so the unread state would be correct exactly once — for somebody who
     * never came back.
     */
    const read = ROUTE.indexOf('invitesSeenAtFor');
    const write = ROUTE.indexOf('await markInvitesSeen');
    expect(read).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(read);
    expect(ROUTE).toMatch(/since === null \|\| item\.at > since/);
  });

  it('clears the badge by being read, as the page does', () => {
    // Marking read is a side effect of having read. The alternative is a
    // second round trip to record that the first one happened.
    expect(ROUTE).toMatch(/markInvitesSeen\(db, actorId\)/);
    expect(PAGE).toMatch(/markInvitesSeen\(db, actorId\)/);
  });

  it('is scoped by the shape of its queries, not by a capability check', () => {
    /*
     * Both readers take the actor and every query inside them is scoped to it —
     * the same arrangement `/api/requests` and `/api/events` have. There is no
     * event or photo here to guard, which is why `access-chokepoint` does not
     * reach it either.
     */
    expect(ROUTE).toMatch(/const actorId = await currentActorId\(\)/);
    expect(ROUTE).not.toMatch(/schema\.(photos|events)\b/);
  });
});

/**
 * The shape of a row that does not fit on one line.
 *
 * On a phone the sentence has about forty characters to work with, and several
 * of these kinds quote what somebody said — so two, three and four lines are
 * ordinary rather than exceptional. Centred, every fixed-size thing in the row
 * drifted to the middle of the text: the picture of who did it ended up beside
 * the third line of what they said, with a hole above it where the row began,
 * and the time and the `···` went with it. A row reads from the thing it is
 * *from*, and that thing has to be where the row starts.
 *
 * The reason this needs a test rather than an eye is the other half of the
 * change. Top-aligning alone would have moved every one-line row — which is
 * most of them — so each fixed-size part is nudged down by exactly the
 * difference between its own line and the 34px square. Get one of those numbers
 * wrong and nothing breaks; the row is simply a pixel or two crooked in a way
 * that is hard to see and impossible to unsee.
 */
describe('a row that runs to several lines', () => {
  it('hangs everything from the top rather than the middle', () => {
    const row = RULES.slice(
      RULES.indexOf('.activity-row {'),
      RULES.indexOf('.activity-new {'),
    );
    expect(row).toMatch(/\.activity-row \{[^}]*align-items: flex-start/);
    expect(row).toMatch(
      /\.activity a, \.activity > li > span \{[^}]*align-items: flex-start/,
    );
    /*
     * The one `center` left in that block is inside the `···` button, where it
     * centres the glyph in its own 58px box — the thing that puts it on the
     * square. Both flex containers that hold the row's parts are `flex-start`,
     * and the two assertions above are what say so; a stray `center` on either
     * would have to replace one of them to take effect.
     */
    expect(row.match(/align-items: center/g) ?? []).toHaveLength(1);
  });

  it('keeps a one-line row exactly where it was', () => {
    /*
     * The sentence is 14.5px at 1.45, so ≈21px against a 34px square: half the
     * difference is 6.5, which is where centring already put the first line.
     * The time is 12.5px at the same leading, so ≈18px, and half of that
     * difference is 8. Two numbers, two lines, and neither is a round guess.
     */
    expect(RULES).toMatch(/\.activity-said \{[^}]*padding-top: 6\.5px/);
    expect(RULES).toMatch(/\.activity-when \{[^}]*padding-top: 8px/);
    // The strip's squares are 38 rather than 34, so it goes the other way.
    expect(RULES).toMatch(/\.activity-strip \{[^}]*margin-top: -2px/);
  });

  it('puts the ··· on the square rather than on the whole sentence', () => {
    /*
     * A height, not a margin: the glyph centres in the row's first line, which
     * is the square plus the link's padding either side of it. 12 + 34 + 12 on
     * a desktop and 10 + 34 + 10 below 720px, where the link's padding is
     * smaller. A margin measured from the top would have to be recomputed
     * whenever either number moved.
     */
    expect(RULES).toMatch(/\.activity-row \.dots-go \{[\s\S]{0,160}height: 58px/);
    expect(RULES).toMatch(/\.activity-row \.dots-go \{ height: 54px; \}/);
  });

  it('still drops the time under the sentence on a phone', () => {
    /*
     * At that width a column of times is competing with the sentence for the
     * same forty characters, so the time wraps to its own line under it —
     * once the sentence is long enough to push it there. Between about 420
     * and 720 it still fits beside the square, which is why this breakpoint
     * must not undo the nudge: doing so left the time six pixels high on
     * every row in that band, and where it does wrap the same eight pixels
     * are simply the gap above it.
     */
    const phone = RULES.slice(RULES.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/\.activity-when \{[\s\S]{0,120}margin-left: 46px/);
    expect(phone).not.toMatch(/\.activity-when \{[\s\S]{0,120}padding-top/);
  });
});
