/**
 * Somebody else's page, on a phone.
 *
 * Source checks, because there is no renderer in this suite. What they guard
 * is the pair of rules that make this screen what it is: it should look like
 * the viewer's own profile, and it must not tell you anything about somebody
 * that being findable was not meant to tell you.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

/**
 * Somebody else's page looks like your own.
 *
 * It was a stack of bordered cards: a 64pt circle beside a name in one, the
 * shared albums as text rows in a second, their other albums as text rows in a
 * third. A settings list, for the one screen in this product that is a person
 * — and reached from a byline on a card whose whole subject is a photograph.
 *
 * The web has drawn it the other way round for a while: `PersonView` uses the
 * same `you-head` block the viewer's own profile does, with the one thing you
 * can do about somebody where Edit profile sits. This brings the app across.
 */
describe('the shape of somebody else’s page', () => {
  const PERSON = read('src/Person.tsx');
  const PROFILE = read('src/Profile.tsx');

  it('draws the same head the viewer’s own profile draws', () => {
    // The name and the handle on the left, the picture bleeding off the right.
    for (const source of [PERSON, PROFILE]) {
      expect(source).toMatch(/avatar: \{\s*\n\s*width: 124,\s*\n\s*height: 104,/);
      expect(source).toMatch(/borderTopLeftRadius: 26,[\s\S]{0,120}borderTopRightRadius: 0,/);
    }
    expect(PERSON).toMatch(/name: \{ fontSize: 28, lineHeight: 31, fontWeight: '700'/);
    // A letter on their own lens where there is no picture, never a
    // silhouette — the rule every face in this product follows.
    expect(PERSON).toMatch(/const lens = lensFor\(person\.handle\)/);
  });

  it('shows the line they wrote about themselves', () => {
    /*
     * `profileFor` was already selecting `bio` and the route was dropping it,
     * so the site had a person on this screen and the app had a name and a
     * button.
     */
    const ROUTE = readFileSync(
      fileURLToPath(new URL('../../web/app/api/people/[handle]/route.ts', import.meta.url).href),
      'utf8',
    );
    expect(ROUTE).toMatch(/bio: person\.bio,/);
    expect(read('src/api.ts')).toMatch(/bio: string \| null;/);
    expect(PERSON).toMatch(/\{person\.bio && </);
  });

  it('offers one control where the profile offers two', () => {
    /*
     * Edit profile and Share profile are things you do to your own page;
     * neither means anything on somebody else's. What is left is the one thing
     * you can do about a person.
     *
     * "Friends" is still worn as a label — there is nothing to press, and a
     * control reporting a state is one somebody presses to find out it does
     * nothing. An open request is the exception and always was: it is the
     * viewer's own to withdraw, so it is a button.
     */
    expect(PERSON).toMatch(/>Add friend</);
    expect(PERSON).toMatch(/>Friends</);
    expect(PERSON).toMatch(/standing === 'none' && \(/);
    /*
     * No Edit, no Share, no Settings — none of the three is about them.
     *
     * Comments stripped: the note beside the row names the two controls it
     * replaced, and prose about a button is not a button.
     */
    const code = PERSON.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/Edit profile|Share profile|Settings/);
    // The one standing with a decision in it keeps two buttons.
    expect(PERSON).toMatch(/>Accept</);
    expect(PERSON).toMatch(/>Decline</);
  });

  it('takes an open request back rather than reporting it', () => {
    /*
     * It said "Asked" on a flat panel, which left the only thing in the
     * viewer's gift — withdrawing — with nowhere to be done from: the way out
     * of that state was for the other person to answer.
     *
     * "Requested" is the state rather than the past tense of the act, and
     * pressing it clears both open rows between the two actors, so asking
     * again is possible and nothing is left for the next ask to collide with.
     */
    expect(PERSON).toMatch(/>Requested</);
    expect(PERSON).not.toMatch(/>Asked</);
    expect(PERSON).toMatch(/onPress=\{\(\) => void unask\(\)\}/);
    expect(PERSON).toMatch(/api\.unaskFriend\(person\.actorId\)/);
    expect(PERSON).toMatch(/setStanding\('none'\)/);
    expect(read('src/api.ts')).toMatch(/method: 'DELETE'/);
  });

  it('prints their three totals, worked out once on the server', () => {
    /*
     * The page used to print one number — how many of *your* albums they are
     * in — on the argument that their own totals would turn search into a way
     * to measure strangers. The shelf below undid that argument: every album
     * they made is already listed there by name, locked ones included.
     *
     * Counted by `profileFor` rather than by either client, so this screen and
     * `/u/<handle>` cannot drift into disagreeing about what an album is.
     */
    expect(PERSON).toMatch(/person\.counts\.albums/);
    expect(PERSON).toMatch(/person\.counts\.photos/);
    expect(PERSON).toMatch(/person\.counts\.friends/);
    expect(PERSON).not.toMatch(/'albums'\} with you/);
    expect(read('src/api.ts')).toMatch(
      /counts: \{ albums: number; photos: number; friends: number \}/,
    );
    const PEOPLE = readFileSync(
      fileURLToPath(new URL('../../web/src/people.ts', import.meta.url).href),
      'utf8',
    );
    expect(PEOPLE).toMatch(/async function countsFor/);
    // Deleted albums out, and a photograph counted only once it is ready —
    // the same two clauses `albumsBy` applies per album.
    expect(PEOPLE).toMatch(/e\.deleted_at is null/);
    expect(PEOPLE).toMatch(/p\.status = 'ready' and p\.deleted_at is null/);
  });

  it('gives the letter the picture’s shape, and the handle its sigil', () => {
    /*
     * The slot a picture goes in keeps its shape whether or not there is one
     * in it: a 64pt circle where a 124×104 panel would be made a page without
     * a photograph a visibly different, smaller page.
     *
     * And the handle keeps its `@`. A name is bare and a handle is not — the
     * sigil is what marks the string as the thing you can type at a search
     * box, which is why the fallback in `nameOf` wears one too.
     */
    expect(PERSON).toMatch(/styles\.avatar, styles\.avatarBlank/);
    expect(PERSON).toMatch(/@\{person\.handle\}/);
  });

  it('draws their albums as one shelf of covers', () => {
    /*
     * Two bordered cards of text rows became one wall of covers, which is the
     * point of the screen: what this person has is photographs, and a list of
     * names in a panel is a directory of them.
     *
     * One shelf from two lists, because they are one thing to the person
     * reading. `shared` rows carry a cover and a count from this app's own
     * list — every one of them was already in it — and `albums` brings the
     * rest.
     */
    expect(PERSON).toMatch(/const shelf = \[/);
    expect(PERSON).toMatch(/cover: mine\?\.cover\?\.src \?\? event\.thumb/);
    expect(PERSON).toMatch(/grid: \{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP \}/);
    // The same two-column shelf the viewer's own profile lays out.
    for (const source of [PERSON, PROFILE]) {
      expect(source).toMatch(/const COLUMNS = 2;/);
      expect(source).toMatch(/\(width - 40 - GAP \* \(COLUMNS - 1\)\) \/ COLUMNS/);
    }
  });
});
