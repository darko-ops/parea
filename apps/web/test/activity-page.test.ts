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

  it('still goes to the event when an invitation is accepted', () => {
    // The only answer that changes what is reachable, so the only one that
    // needs the page rebuilt — in the event that just opened.
    expect(WAITING).toMatch(/kind === 'invite'/);
    expect(WAITING).toMatch(/window\.location\.href = `\/event\/\$\{request\.eventId\}`/);
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
     */
    expect(PAGE).toMatch(/function bucketFor/);
    expect(PAGE).toMatch(/bucket: bucketFor\(item\.at, now\)/);
    expect(LIST).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });

  it('are calendar days, not twenty-four-hour windows', () => {
    // 9am today and 11pm last night are fourteen hours apart and belong under
    // different words. That is the entire point of the headings.
    expect(PAGE).toMatch(/getFullYear\(\), \w+\.getMonth\(\), \w+\.getDate\(\)/);
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

  it('says the same thing as before when there is nothing in it', () => {
    // Verbatim. It is the one sentence on this page that explains what the
    // page is for, and it is read by people who have nothing to look at.
    expect(LIST).toContain(
      'Nothing yet. When somebody adds photos to an event you are in, says',
    );
  });

  it('puts a row back when hiding it did not send', () => {
    expect(LIST).toMatch(/setRows\(before\)/);
    expect(LIST).toMatch(/'\/api\/activity\/hidden'/);
    expect(LIST).toMatch(/key: row\.id/);
  });
});
