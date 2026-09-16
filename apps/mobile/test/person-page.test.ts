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
     * The quiet standings are worn as a label rather than offered as a button:
     * "Friends" and "Asked" are states, and a control that reports a state is
     * a control somebody presses to find out it does nothing.
     */
    expect(PERSON).toMatch(/>Add friend</);
    expect(PERSON).toMatch(/standing === 'friends' \? 'Friends' : 'Asked'/);
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

  it('still refuses to total them up', () => {
    /*
     * The counts line on your own profile says albums, photographs and
     * friends. Here it says one number and it counts the *viewer's* shelf:
     * how many of your albums this person is also in.
     *
     * Their totals are not on this page and must not become so — "41 albums ·
     * 900 photos" would make search a way to measure strangers, which is the
     * whole reason being findable leads to being able to ask and no further.
     * The web says the same thing in the same words.
     */
    expect(PERSON).toMatch(/\{shared\.length === 1 \? 'album' : 'albums'\} with you/);
    expect(PERSON).not.toMatch(/friends'\}\s*<\/Text>\s*<\/Text>/);
    expect(PERSON).not.toMatch(/photos\b[^)]*\}\s*·/);
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
