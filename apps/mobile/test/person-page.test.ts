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
    /*
     * A centred column under a picture hanging from the top edge — not a row
     * with the words ranged left and the picture bleeding off the right.
     *
     * That row is what both pages used to be, and it is the half of the
     * redesign somebody else's page was left holding: the profile took the
     * tab and this screen kept the shape it replaced, so the app told you
     * whose page you were on by rearranging it.
     *
     * The same styles, written the same way in both files. The head itself is
     * not one component — the counts are a control on your own page and facts
     * on theirs — but the shape is one shape, and two sets of numbers for it is
     * how it comes apart again. The link is on both now: it is a fact about
     * somebody, and a field whose whole purpose is other people's screens was
     * being drawn only on its owner's.
     */
    for (const source of [PERSON, PROFILE]) {
      expect(source).toMatch(/head: \{ alignItems: 'center' \}/);
      expect(source).toMatch(/name: \{[\s\S]{0,120}?textAlign: 'center',[\s\S]{0,160}?fontSize: 28,/);
      expect(source).toMatch(/handle: \{ textAlign: 'center', fontSize: 14\.5, marginTop: 3 \}/);
      expect(source).toMatch(/counts: \{ textAlign: 'center', fontSize: 14\.5, marginTop: 8 \}/);
      expect(source).toMatch(/link: \{ textAlign: 'center', fontSize: 14\.5, marginTop: 6 \}/);
      /*
       * And the bio in the column with them rather than under it.
       *
       * It used to be a child of the scroller in both files, which made the
       * space above it the scroller's `gap: 16` plus its own leading — about
       * twenty points under a link that sits six under the counts, so the
       * header read as finished and the sentence belonging to it as a new
       * section. `marginTop: 6` is the same step as the rest of the column, and
       * the inset is 16 against the gutter's 20: the 36 this had when it was
       * full width, kept to the point.
       */
      expect(source).toMatch(/bio: \{[\s\S]{0,200}?alignSelf: 'stretch',[\s\S]{0,40}?marginTop: 6,/);
      expect(source).toMatch(/bio: \{[\s\S]{0,200}?textAlign: 'center',[\s\S]{0,40}?paddingHorizontal: 16,/);
      expect(source).not.toMatch(/bio: \{ fontSize: 15, lineHeight: 21, textAlign: 'center', paddingHorizontal: 36 \}/);
    }
    // Nothing left of the row: no picture in the header, no gutter exemption.
    expect(PERSON).not.toMatch(/flexDirection: 'row', alignItems: 'center', paddingLeft: 20/);
    // A letter on their own lens where there is no picture, never a
    // silhouette — the rule every face in this product follows.
    expect(PERSON).toMatch(/const lens = lensFor\(person\.handle\)/);
  });

  it('hangs their picture from the same tab yours hangs from', () => {
    /*
     * One file, because the numbers in it are a phone's measurements rather
     * than anybody's taste: where the front camera stops, how much of the
     * picture survives a scroll, how far the whole thing narrows. A second
     * set of them is how the same face comes to hang differently depending on
     * whose it is.
     */
    for (const source of [PERSON, PROFILE]) {
      expect(source).toMatch(/import \{ HangingTab, TAB_H \} from '\.\/HangingTab'/);
      expect(source).toMatch(/<HangingTab/);
      expect(source).toMatch(/scroll: \{ paddingTop: TAB_H \+ 22,/);
    }
    // Yours opens the editor. Theirs is a photograph and nothing to press —
    // the same argument the standings below it settle for this screen.
    expect(PROFILE).toMatch(/onPress=\{\(\) => setEditing\(true\)\}/);
    const tab = PERSON.slice(PERSON.indexOf('<HangingTab'));
    expect(tab.slice(0, tab.indexOf('/>'))).not.toMatch(/onPress/);
  });

  it('keeps the way back out of the tab’s way', () => {
    /*
     * It was a `‹` on the first line of the scroll, which works under a
     * header that scrolls with it. The picture hangs from the top edge now,
     * so that chevron would slide up under the tab on the first flick and
     * take the way off this screen with it.
     *
     * The same disc, in the same corner, at the same height as the `⋯` the
     * viewer's own profile keeps there.
     */
    expect(PERSON).toMatch(/<Back color=\{t\.fg\} \/>/);
    expect(PERSON).toMatch(/corner: \{ position: 'absolute', top: 62, left: 20, zIndex: 3 \}/);
    expect(PROFILE).toMatch(/corner: \{ position: 'absolute', top: 62, left: 20, zIndex: 3 \}/);
    expect(PERSON).not.toMatch(/styles\.back/);
    // Including on the two pages that have no person on them yet.
    expect(PERSON.match(/\{back\}/g) ?? []).toHaveLength(3);
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
     * in it: a 64pt circle where a photograph would be a whole tab makes a
     * page without a photograph a visibly different, smaller page. The tab
     * draws both states out of one box — see `HangingTab` — so this page gets
     * that for nothing, and the letter it hands over is theirs.
     *
     * And the handle keeps its `@` — on the handle line. That is where the
     * sigil is doing its job: it marks the string as the thing you can type
     * at a search box. `nameOf` hands its fallback over bare, because there
     * the handle is standing in for a name, and a name does not open with
     * punctuation.
     */
    expect(PERSON).toMatch(/initial=\{initialOf\(name\)\}/);
    expect(PERSON).toMatch(/lens=\{lens\}/);
    expect(read('src/HangingTab.tsx')).toMatch(/styles\.tabFill, styles\.tabBlank\]/);
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
