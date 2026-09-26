/**
 * What the search box is allowed to find.
 *
 * This is the page where §3's rule is most easily broken by accident, because
 * every kind of thing somebody might look for now shares one input: your
 * events, your friends, anybody by handle, findable groups. Three of those are
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
const CSS = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

describe('the box searches four things and no more', () => {
  it('asks the two endpoints that are allowed to be asked', () => {
    expect(VIEW).toMatch(/\/api\/people\?q=/);
    expect(VIEW).toMatch(/\/api\/groups\/search\?q=/);
  });

  it('never asks anything for events or photos', () => {
    /*
     * The line the product is built on. An event search endpoint would turn
     * "possession of the link is the access model" into "type a word and see
     * whose wedding comes up", and there is deliberately nothing to call.
     */
    expect(VIEW).not.toMatch(/\/api\/events\?|\/api\/photos|search\?q=[^)]*event/i);
  });

  it('matches events against a list the server chose, in the browser', () => {
    // Substring matching is safe here and only here: every row was on the home
    // screen a second ago, so nothing can be found that was hidden.
    expect(PAGE).toMatch(/eventsFor\(db, actorId\)/);
    expect(PAGE).toMatch(/haystack: searchable\(listing\)/);
    expect(VIEW).toMatch(/events\.filter\(\(a\) => matches\(a\.haystack, term\)\)/);
  });
});

describe('one matcher, not two', () => {
  it('uses the home screen’s, rather than a second copy', () => {
    /*
     * Two implementations of "every term appears somewhere" drift on the first
     * bug, and the drift is one screen finding an event the other cannot.
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

  it('holds something under each heading it shows', () => {
    /*
     * A heading that only fills up after you type is a heading nobody knows
     * is there. Suggested people, findable groups a friend is in, and the
     * groups you are in yourself are all things the server decided you may
     * see, so showing them discloses nothing.
     */
    expect(VIEW).toMatch(/!asking && wantsGroups && suggestedGroups\.length > 0/);
    expect(VIEW).toMatch(/!asking && wantsPeople && suggested\.length > 0/);
    expect(VIEW).toMatch(/!asking && wantsGroups && mine\.length > 0/);
    expect(PAGE).toMatch(/groupsFor\(db, actorId\)/);
    expect(PAGE).toMatch(/suggestedGroupsFor\(db, actorId\)/);
  });

  it('does not list events back, and says why not', () => {
    /*
     * The one heading that was removed rather than redrawn. "Your events" was
     * a worse copy of the home screen one tap away — and, more to the point, a
     * list of events under a heading on a search page is one ticket away from
     * a list of somebody else's.
     *
     * The sentence is the other half. An absence cannot explain itself: with
     * the heading simply gone, the page reads as broken rather than as a
     * product that will not do this.
     */
    // `events` survives as a prop because typing still matches against it.
    // What went is every use of it that draws a list nobody asked for.
    expect(VIEW).not.toMatch(/!asking && wantsEvents/);
    expect(VIEW).not.toMatch(/IDLE_EVENTS|events\.slice/);
    expect(VIEW).toMatch(/Albums are never recommended/);
  });

  it('offers groups as a door and never as a way in', () => {
    /*
     * The only recommendation in the product. What makes it allowed is that
     * what comes back is a name and a count, the reader still has to ask, and
     * the friends who are already in it are named — because they are how this
     * was reachable anyway.
     */
    expect(VIEW).toMatch(/You would still be asking to be\s+let in/);
    expect(VIEW).toMatch(/`\/api\/groups\/\$\{group\.id\}\/requests`/);
    expect(VIEW).toMatch(/\$\{who\} \$\{verb\} in this/);
    // Two names and then a number. The third name is where a sentence turns
    // into a membership list, which is not this card's to publish.
    expect(VIEW).toMatch(/\$\{rest\} \$\{rest === 1 \? 'other' : 'others'\}/);
  });

  it('keeps the rules, one click away rather than first', () => {
    // Still on the page and still true — a rule somebody wants at the moment
    // a search surprises them, which is not the moment they arrive.
    expect(VIEW).toMatch(/<summary>How search works<\/summary>/);
    expect(VIEW).toMatch(/Photos are never searched/);
  });
});

describe('narrowing the scope narrows what is asked', () => {
  it('makes no lookup at all when the box is pointed at your own events', () => {
    /*
     * The scope is not a filter over one result set. Events are matched in
     * the browser, so pressing Events means `/api/people` and
     * `/api/groups/search` are not called — narrowing the search also narrows
     * what the page tells the server about what you are looking for.
     */
    expect(VIEW).toMatch(/const askPeople = within === 'all' \|\| within === 'people'/);
    expect(VIEW).toMatch(/const askGroups = within === 'all' \|\| within === 'groups'/);
    expect(VIEW).toMatch(/askGroups\s*\?\s*fetch\(`\/api\/groups\/search\?q=/);
    expect(VIEW).toMatch(/askPeople\s*\?\s*fetch\(`\/api\/people\?q=/);
  });

  it('asks again when the scope changes, not only when the text does', () => {
    // Otherwise widening from Events to All shows the two lookups' last
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
    expect(VIEW).toMatch(/`\/event\/\$\{event\.id\}`/);
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
     * broader — people in your events, people who share a group — would be a
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
    /*
     * `person.mutuals` is a number and is only ever drawn as one. A group
     * card does name friends — deliberately, and they are a different set:
     * the reader's own friends, who are how that group was reachable anyway.
     * A friend-of-a-friend's mutuals are somebody else's relationships.
     */
    expect(VIEW).not.toMatch(/mutualNames|person\.mutuals\.map/);
  });

  it('is bounded', () => {
    expect(FRIENDS).toMatch(/export const SUGGESTION_LIMIT = 12/);
    expect(SUGGEST).toMatch(/limit \$\{SUGGESTION_LIMIT\}/);
  });
});

describe('what a result calls somebody', () => {
  it('never opens a name with the handle\u2019s sigil', () => {
    /*
     * A result for somebody with no name written in read "@wren" in bold with
     * "@wren" in grey underneath: the sigil doing its job on one line and
     * decorating a name on the other.
     *
     * The `@` marks a string as the thing you can type into the box above —
     * that is what it is for, and the handle line is where it earns it. The
     * name slot is what somebody is called, and a name does not start with
     * punctuation. Same rule as the top of the profile this row opens.
     */
    expect(VIEW).toMatch(/const name = person\.displayName\?\.trim\(\) \|\| person\.handle \|\| 'Someone';/);
    expect(VIEW).not.toMatch(/const name = person\.displayName\?\.trim\(\) \|\| \(person\.handle \? `@/);
    // And the handle keeps its own line, which is the half that should have it.
    expect(VIEW).toMatch(/person\.handle \? `@\$\{person\.handle\}` : ''/);
  });

  it('says the same thing in the app', () => {
    const RESULTS = read('../../mobile/src/Events.tsx');
    expect(RESULTS).toMatch(/name=\{person\.displayName\?\.trim\(\) \|\| person\.handle \|\| 'Someone'\}/);
    // The handle under it whether or not a name is above — it used to appear
    // only when there was one, which left the `@` living on the name line.
    expect(RESULTS).toMatch(/under=\{person\.handle \? `@\$\{person\.handle\}` : null\}/);
  });
});

describe('what the box remembers', () => {
  it('keeps the last ten in this browser and nowhere else', () => {
    /*
     * A search term is a sentence about who somebody was looking for. This
     * product keeps none: there is no table, no request and no field — the
     * list lives in the browser that typed it, which is why the assertion
     * below is that nothing reaches the server.
     */
    expect(VIEW).toMatch(/const RECENT_MAX = 10;/);
    expect(VIEW).toMatch(/localStorage\.setItem\(RECENT_KEY/);
    expect(VIEW).not.toMatch(/fetch\([^)]*recent|\/api\/[a-z]*search[^)]*post/i);
  });

  it('remembers a search rather than a keystroke', () => {
    /*
     * The box asks on a 250ms debounce, so every prefix of a name is a
     * request — "w", "wr", "wre" — and a list built from those is a history of
     * nothing. What means "this was the search" is pressing Enter, or opening
     * one of the answers. Both, because either can be the last thing somebody
     * does.
     */
    expect(VIEW).toMatch(/if \(e\.key === 'Enter'\) remember\(query\)/);
    expect(VIEW).toMatch(/onOpen=\{\(\) => remember\(query\)\}/);
    // Below `MIN`, a term is a prefix of everybody and not a search.
    expect(VIEW).toMatch(/if \(term\.length < MIN\) return;/);
  });

  it('survives a browser that refuses to store anything', () => {
    /*
     * `localStorage` throws in a Safari private window rather than returning
     * null, and the value could be anything another tab or an older version
     * wrote. A search page that will not render because of its own
     * convenience list is worse than one without the list.
     */
    expect(VIEW).toMatch(/function readRecent\(\): string\[\] \{[\s\S]*?catch \{[\s\S]*?return \[\];/);
    expect(VIEW).toMatch(/if \(!Array\.isArray\(parsed\)\) return \[\];/);
    // Read after mount, never during render: the server has no localStorage,
    // and a list that differs between its HTML and the first client pass is a
    // hydration mismatch.
    expect(VIEW).toMatch(/useEffect\(\(\) => setRecent\(readRecent\(\)\), \[\]\)/);
  });

  it('offers a way to forget, beside the list itself', () => {
    // A shared laptop is the ordinary reason to want it gone, and the place
    // people look for that is the list, not a settings page.
    expect(VIEW).toMatch(/onClick=\{forgetAll\}/);
    expect(VIEW).toMatch(/writeRecent\(\[\]\)/);
  });
});

describe('asking somebody from a result', () => {
  it('offers it to a stranger and to nobody else', () => {
    /*
     * Being findable leads to being asked and to nothing else — so the ask
     * belongs where somebody is found, rather than two screens away on a
     * profile they have to open and come back from.
     *
     * The other standings are words, not controls. Withdrawing is somebody's
     * own to do and is done on their page; answering an ask wants Accept and
     * Decline side by side and room to say what they mean, which a row does
     * not have.
     */
    expect(VIEW).toMatch(/standing === 'none' && \([\s\S]{0,200}Add friend/);
    expect(VIEW).toMatch(/standing === 'asked' && <span className="hit-said">Requested/);
    expect(VIEW).toMatch(/standing === 'asking' && \([\s\S]{0,200}Asked you/);
  });

  it('makes the same request the profile makes', () => {
    // One endpoint, so a list and a page cannot come to disagree about what
    // asking does — including the crossed case, where `/api/friends` answers
    // an open request of theirs instead of opening a second one.
    expect(VIEW).toMatch(/fetch\('\/api\/friends', \{[\s\S]{0,160}method: 'POST'/);
    expect(VIEW).toMatch(/JSON\.stringify\(\{ actorId: person\.actorId \}\)/);
    expect(VIEW).toMatch(/body\.status === 'accepted' \? 'friends' : 'asked'/);
  });

  it('puts the control beside the row rather than inside it', () => {
    // A `<button>` inside an `<a>` is a button that navigates, whichever the
    // browser decides wins. They are siblings, and the link takes the rest.
    expect(VIEW).toMatch(/<li className="hit-row">/);
    expect(CSS).toMatch(/\.hit-row \{ display: flex;/);
    expect(CSS).toMatch(/\.hit-row \.hit \{ flex: 1; min-width: 0; \}/);
  });

  it('knows where the two of you stand before anybody presses', () => {
    /*
     * Without this the row offers "Add friend" to somebody asked last week.
     * It comes from `/api/people` and it is a fact about the reader rather
     * than about the person found — see `friends.test.ts`.
     *
     * The local lists send none, and the default is `friends`: this page's
     * other person list is the reader's own friends, who are friends by
     * definition rather than by guess.
     */
    expect(VIEW).toMatch(/standing\?: Standing;/);
    expect(VIEW).toMatch(/useState<Standing>\(person\.standing \?\? 'friends'\)/);
    const PEOPLE = read('../app/api/people/route.ts');
    expect(PEOPLE).toMatch(/\.\.\.person/);
  });
});
