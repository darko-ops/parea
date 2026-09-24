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

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const read = async (path: string) =>
  stripComments(await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const PAGE = await read('../app/activity/page.tsx');
const WAITING = await read('../app/components/PendingRequests.tsx');
const LIST = await read('../app/components/ActivityList.tsx');
const WELCOME = await read('../app/components/Welcome.tsx');
/* The wording moved out of the page when the phone started drawing the same
   feed: one implementation of "is this today?", for both clients. */
const WHEN = await read('../src/when.ts');
const ROUTE = await read('../app/api/activity/route.ts');

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

  it('still says what the page is for when there is nothing in it', () => {
    /*
     * Verbatim, and it has moved. It is the one sentence on this page that
     * explains what the page is for, and it is read by people who have nothing
     * to look at — so it survives the move from a grey paragraph into the
     * welcome row, in the voice of the thing that will be saying the rest.
     *
     * The list itself now draws nothing when it is empty: "the page is empty"
     * is a question only the page can answer, because it has two sections
     * above this one.
     */
    // Whitespace flattened: the sentence is wrapped across three lines of JSX,
    // and where the line breaks fall is not part of what it says.
    expect(WELCOME.replace(/\s+/g, ' ')).toContain(
      'When somebody adds photos to an album you are in, says something about yours, or opens one to you, it turns up here.',
    );
    expect(LIST).toMatch(/if \(rows\.length === 0\) return null;/);
  });

  it('greets nobody who is already halfway through using it', () => {
    // A friend request waiting is a page with something on it, and a welcome
    // under it would be the product introducing itself to somebody who has
    // already been introduced. All three sections, not just this list.
    expect(PAGE).toMatch(
      /requests\.length === 0 && asked\.length === 0 && items\.length === 0/,
    );
  });

  it('does not dress the welcome as something that happened', () => {
    /*
     * A synthetic row in a list of things that actually happened is a lie the
     * moment somebody cannot tell. Three things keep it apart from its
     * neighbours, and each is the absence of something every real row has:
     * the mark instead of a face, no time, and no `⋯` to hide it by — it
     * leaves on its own, the moment there is anything to replace it.
     */
    expect(WELCOME).toMatch(/<Mark size=\{26\} \/>/);
    expect(WELCOME).not.toMatch(/<Face|activity-when|<Menu/);
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
