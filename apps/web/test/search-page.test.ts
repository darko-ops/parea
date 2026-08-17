/**
 * What the search box is allowed to find.
 *
 * This is the page where §3's rule is most easily broken by accident, because
 * every kind of thing somebody might look for now shares one input: your
 * albums, your friends, anybody by handle, findable groups. Three of those are
 * lists this person already holds; one is a lookup against everybody.
 *
 * The test is a source scan and the reason is worth stating: what has to hold
 * is *which endpoint each kind of result comes from*, and that is a property
 * of the wiring rather than of any value the component computes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { matches, searchable } from '@/search';
import { stripComments } from './support/source';

const read = (path: string) =>
  stripComments(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const VIEW = read('../app/components/FindView.tsx');
const PAGE = read('../app/find/page.tsx');

describe('the box searches four things and no more', () => {
  it('asks the two endpoints that are allowed to be asked', () => {
    expect(VIEW).toMatch(/\/api\/people\?q=/);
    expect(VIEW).toMatch(/\/api\/groups\/search\?q=/);
  });

  it('never asks anything for albums or photos', () => {
    /*
     * The line the product is built on. An album search endpoint would turn
     * "possession of the link is the access model" into "type a word and see
     * whose wedding comes up", and there is deliberately nothing to call.
     */
    expect(VIEW).not.toMatch(/\/api\/events\?|\/api\/photos|search\?q=[^)]*event/i);
  });

  it('matches albums against a list the server chose, in the browser', () => {
    // Substring matching is safe here and only here: every row was on the home
    // screen a second ago, so nothing can be found that was hidden.
    expect(PAGE).toMatch(/eventsFor\(db, actorId\)/);
    expect(PAGE).toMatch(/haystack: searchable\(listing\)/);
    expect(VIEW).toMatch(/albums\.filter\(\(a\) => matches\(a\.haystack, term\)\)/);
  });
});

describe('one matcher, not two', () => {
  it('uses the home screen’s, rather than a second copy', () => {
    /*
     * Two implementations of "every term appears somewhere" drift on the first
     * bug, and the drift is one screen finding an album the other cannot.
     */
    expect(VIEW).toMatch(/import \{ matches \} from '@\/search'/);
    expect(VIEW).not.toMatch(/split\(\/\\s\+\//);
  });

  it('finds the words somebody actually remembers', () => {
    // Not adjacent, and not in the order they were written.
    const haystack = searchable({ name: 'Sunday roast', place: 'The Anchor' });
    expect(matches(haystack, 'roast anchor')).toBe(true);
    expect(matches(haystack, 'anchor roast')).toBe(true);
    expect(matches(haystack, 'roast pub')).toBe(false);
  });
});

describe('what the page offers before anybody types', () => {
  it('names the three things it finds', () => {
    // The page's answer to "what can I find here". It used to be a paragraph
    // of rules, which describes the page instead of being it.
    for (const scope of ['All', 'People', 'Albums', 'Groups']) {
      expect(VIEW).toMatch(new RegExp(`\\['\\w+', '${scope}'\\]`));
    }
  });

  it('holds something under each of them with nothing typed', () => {
    /*
     * Three headings that only fill up after you type are three headings
     * nobody knows are there. Suggestions, your own albums and your own
     * groups are all lists the server already decided you may see, so showing
     * them costs no lookup and discloses nothing.
     */
    expect(VIEW).toMatch(/!asking && wantsPeople && suggested\.length > 0/);
    expect(VIEW).toMatch(/!asking && wantsAlbums && albums\.length > 0/);
    expect(VIEW).toMatch(/!asking && wantsGroups && mine\.length > 0/);
    expect(PAGE).toMatch(/groupsFor\(db, actorId\)/);
  });

  it('keeps the rules, one click away rather than first', () => {
    // Still on the page and still true — a rule somebody wants at the moment
    // a search surprises them, which is not the moment they arrive.
    expect(VIEW).toMatch(/<summary>How search works<\/summary>/);
    expect(VIEW).toMatch(/Photos are never searched/);
  });
});

describe('narrowing the scope narrows what is asked', () => {
  it('makes no lookup at all when the box is pointed at your own albums', () => {
    /*
     * The scope is not a filter over one result set. Albums are matched in
     * the browser, so pressing Albums means `/api/people` and
     * `/api/groups/search` are not called — narrowing the search also narrows
     * what the page tells the server about what you are looking for.
     */
    expect(VIEW).toMatch(/const askPeople = within === 'all' \|\| within === 'people'/);
    expect(VIEW).toMatch(/const askGroups = within === 'all' \|\| within === 'groups'/);
    expect(VIEW).toMatch(/askGroups\s*\?\s*fetch\(`\/api\/groups\/search\?q=/);
    expect(VIEW).toMatch(/askPeople\s*\?\s*fetch\(`\/api\/people\?q=/);
  });

  it('asks again when the scope changes, not only when the text does', () => {
    // Otherwise widening from Albums to All shows the two lookups' last
    // answer, which is nothing.
    expect(VIEW).toMatch(/search\(query, scope\)/);
    expect(VIEW).toMatch(/\}, \[query, scope, search\]\)/);
  });
});

describe('who appears under People', () => {
  it('leaves out the ones already on the friends list', () => {
    // They are two headings on one screen, and somebody appearing under both
    // reads as two people with the same name.
    expect(VIEW).toMatch(/const friendIds = new Set\(friends\.map\(\(f\) => f\.actorId\)\)/);
    expect(VIEW).toMatch(/people\.filter\(\(person\) => !friendIds\.has\(person\.actorId\)\)/);
  });
});

describe('where a result leads', () => {
  it('sends a person to their own page, not to your friends list', () => {
    // Every row used to lead to `/friends` — an answer to "who do I know" for
    // somebody who had just asked "who is this".
    expect(VIEW).toMatch(/`\/u\/\$\{encodeURIComponent\(person\.handle\)\}`/);
    expect(VIEW).toMatch(/`\/event\/\$\{album\.id\}`/);
    expect(VIEW).toMatch(/`\/group\/\$\{door\.id\}`/);
  });

  it('leaves a row with no handle where it was', () => {
    // The page is keyed by handle. Somebody without one is not findable, so
    // linking to them would be linking to a 404.
    expect(VIEW).toMatch(/person\.handle \? `\/u\//);
  });
});

describe('who a suggestion may be', () => {
  const FRIENDS = read('../src/friends.ts');
  const SUGGEST = FRIENDS.slice(
    FRIENDS.indexOf('export async function suggestionsFor'),
    FRIENDS.indexOf('export type FriendRequest'),
  );

  it('is a friend of a friend, and nothing looser', () => {
    /*
     * The weakest suggestion available, and that is the point: somebody you
     * could already reach by asking the friend you have in common. Anything
     * broader — people in your albums, people who share a group — would be a
     * relationship the product invented rather than one that exists.
     */
    expect(SUGGEST).toMatch(/from "friendship" mine/);
    expect(SUGGEST).toMatch(/join "friendship" theirs on theirs\.actor_id = mine\.friend_actor_id/);
  });

  it('excludes yourself, your friends, open requests and blocks', () => {
    // The last one matters most: a block hides two people from each other
    // everywhere, and a suggestion screen is where a missed exclusion becomes
    // somebody reappearing in front of the person who cut them off.
    expect(SUGGEST).toMatch(/theirs\.friend_actor_id <> \$\{actorId\}/);
    expect(SUGGEST).toMatch(/not exists[\s\S]{0,120}from "friendship" f/);
    expect(SUGGEST).toMatch(/not exists[\s\S]{0,120}from "friend_request" r/);
    expect(SUGGEST).toMatch(/not exists[\s\S]{0,160}from "block" b/);
  });

  it('counts the mutuals and never names them', () => {
    /*
     * Naming them tells the reader which of *their own* friends is friends
     * with this person — a fact about those two that neither was asked about.
     * The count is the line; the names are past it.
     */
    expect(SUGGEST).toMatch(/count\(\*\)::int\s+as "mutuals"/);
    expect(VIEW).toMatch(/mutual friends?/);
    expect(VIEW).not.toMatch(/mutualNames|mutuals\.map/);
  });

  it('is bounded', () => {
    expect(FRIENDS).toMatch(/export const SUGGESTION_LIMIT = 12/);
    expect(SUGGEST).toMatch(/limit \$\{SUGGESTION_LIMIT\}/);
  });
});
