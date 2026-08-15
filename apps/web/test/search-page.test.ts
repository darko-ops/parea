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

describe('who appears under People', () => {
  it('leaves out the ones already on the friends list', () => {
    // They are two headings on one screen, and somebody appearing under both
    // reads as two people with the same name.
    expect(VIEW).toMatch(/const friendIds = new Set\(friends\.map\(\(f\) => f\.actorId\)\)/);
    expect(VIEW).toMatch(/people\.filter\(\(person\) => !friendIds\.has\(person\.actorId\)\)/);
  });
});
