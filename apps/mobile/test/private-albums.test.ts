/**
 * Who can see it, on the phone — the two policies and the door between them.
 *
 * Three access policies became two, `public` and `private`, and the app had
 * three separate holes where the third one used to be assumed:
 *
 *   1. **A link to a private album came back as a lie.** `/api/join` refused
 *      every denial as 404, so the app said "Couldn't find that. Check the
 *      link or the code and try again" to somebody holding exactly the right
 *      link. They check it, find it is right, and try again.
 *   2. **The choice could be made once and never changed.** Two pills on the
 *      create screen, and nothing afterwards — the choice is made in the first
 *      thirty seconds, before anybody has been sent anything.
 *   3. **The app sent a policy the server now refuses.** It posted
 *      `account_required`, which is not one of the two and would come back 400.
 *
 * Source checks, because there is no renderer in this suite. They stand in for
 * the simulator run and they catch the screens being quietly taken apart —
 * which for the door means being taken apart into the 404 it replaced.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DOOR = read('src/Door.tsx');
const CREATE = read('src/CreateEvent.tsx');
const PERSON = read('src/Person.tsx');
const API = read('src/api.ts');

describe('the two policies, and nothing between them', () => {
  it('sends one of the two the server offers', () => {
    // It sent `account_required`, which is no longer a value the create route
    // accepts — an app store build doing that would refuse every private
    // album with a 400 nobody could read.
    expect(CREATE).toMatch(/accessPolicy: isPrivate \? 'private' : 'public'/);
    expect(CREATE).not.toMatch(/account_required|link_open|request_access/);
    expect(API).not.toMatch(/account_required|link_open|request_access/);
  });

  it('types the field as the two and no more', () => {
    expect(API).toMatch(/accessPolicy\?: 'public' \| 'private'/);
  });
});

describe('the door of a private album', () => {
  it('is a screen, not a message on the join screen', () => {
    /*
     * A deep link can arrive when the join screen is not mounted — the app may
     * be inside another event, or not running at all — so an error string
     * there has nowhere to appear.
     */
    expect(APP).toMatch(/screen: 'door'; eventId: string; name: string/);
    expect(APP).toMatch(/route\.screen === 'door' &&/);
  });

  it('is where a refused link goes, rather than "couldn’t find that"', () => {
    expect(APP).toMatch(/err\.code === 'approval_required'/);
    expect(APP).toMatch(/setRoute\(\{ screen: 'door'/);
    // And the old message is still there for the case it is true of: a token
    // or code that resolves to nothing at all.
    expect(APP).toMatch(/Couldn't find that/);
  });

  it('names the album from the refusal rather than fetching it', () => {
    // The name comes down with the 403 because the link proved they may know
    // it. Asking the server again from this screen would be asking a question
    // it has already answered — and the endpoint that would answer it is the
    // one refusing them.
    expect(APP).toMatch(/err\.body\.event as/);
    expect(DOOR).not.toMatch(/api\.feed|api\.person|api\.myEvents/);
  });

  it('shows a name and nothing that is behind the door', () => {
    // Everything else — photographs, members, counts, the cover — is what is
    // being asked for, and this screen is the moment before the answer.
    expect(DOOR).toMatch(/PRIVATE ALBUM/);
    expect(DOOR).not.toMatch(/photoCount|contributors|coverUrl|thumb/);
  });

  it('says "Asked" over a decline as well as over an open request', () => {
    /*
     * Telling somebody they were refused is the refuser's to do. The endpoint
     * answers a repeat ask with the status it already holds, so a screen that
     * read "Declined" would say it again on every visit.
     *
     * Matched as rendered text rather than anywhere in the file: the header of
     * `Door.tsx` uses the word while explaining why it is not shown, and a
     * test that cannot tell those apart fails on its own documentation. The
     * web side has `stripComments`; one anchored regex is cheaper here than
     * importing it across a workspace.
     */
    expect(DOOR).not.toMatch(/>\s*Declined/i);
    expect(DOOR).toMatch(/Asked\. It is with whoever made the album/);
  });

  it('hands over rather than reporting a pending ask when it comes back approved', () => {
    // Somebody let them in between the link being sent and the button being
    // pressed. There is a room now, so waiting is the wrong thing to say.
    expect(DOOR).toMatch(/status === 'approved'/);
    expect(DOOR).toMatch(/onLetIn\(\)/);
  });
});

describe('who can see it, after the first thirty seconds', () => {
  it('is changeable on the event screen, by whoever can administer', () => {
    // In the `⋯` sheet now rather than as a card stacked above the
    // photographs. Same question, same call, same gate.
    expect(APP).toMatch(/Who can see it/);
    expect(APP).toMatch(/api\.setAccessPolicy\(event\.id, value\)/);
  });

  it('answers the press before the server does, and then defers to it', () => {
    // One round trip is long enough for a tap to feel ignored. But a local
    // guess left standing would outrank a change made on another device, so
    // the refresh clears it.
    expect(APP).toMatch(/policy \?\? feed\?\.event\.accessPolicy/);
    expect(APP).toMatch(/setPolicy\(null\)/);
  });

  it('says that tightening it evicts nobody', () => {
    // "Private" sounds like it should throw people out. It does not —
    // `authorize` reads participation before the policy — and the screen has
    // to say so, because the person reading it is about to press the pill.
    expect(APP).toMatch(/everyone already here stays in/);
  });
});

describe('somebody else’s albums, on their page', () => {
  it('lists the locked ones with the only thing there is to do about them', () => {
    expect(PERSON).toMatch(/Ask to join/);
    expect(PERSON).toMatch(/api\.askToJoin\(album\.id\)/);
  });

  it('draws no picture and no count for a locked one', () => {
    /*
     * The server sends neither — see `albumsBy` — and the screen must not
     * invent a placeholder that reads as a photograph either.
     *
     * The tile is dashed rather than a letter on a filled square, which it was
     * when the row was a 44pt thumbnail beside a name. At a tile's size a
     * letter on a grey block is a cover somebody chose badly; a dashed outline
     * is the thing that is actually being said, and it is what the viewer's
     * own shelf already draws for an album with nothing in it.
     */
    expect(PERSON).toMatch(/styles\.tile, styles\.tileEmpty/);
    expect(PERSON).toMatch(/tileEmpty: \{\s*\n\s*borderWidth: 1,\s*\n\s*borderStyle: 'dashed',/);
    expect(PERSON).toMatch(/item\.locked\s*\n?\s*\? status/);
    expect(PERSON).toMatch(/'Private · ask to join'/);
    /*
     * A padlock in the empty frame, and only on the locked ones: the same
     * glyph an album's own header wears to mean private, so the thing that
     * means "shut" means it in one shape across the app. An unlocked album
     * with nothing in it keeps the bare frame — nothing is being withheld
     * there — which is why the glyph is behind `item.locked` rather than
     * behind the missing cover it shares with it.
     */
    expect(PERSON).toMatch(/\{item\.locked && <Glyph name="locked"/);
    // And what the padlocks are for, said once above the shelf rather than
    // per tile — a wall of shut doors with no sentence is a refusal.
    expect(PERSON).toMatch(/Become friends to see what&rsquo;s inside\./);
    expect(PERSON).toMatch(/standing !== 'friends' && shelf\.some\(\(item\) => item\.locked\)/);
    /*
     * And the two lists become one shelf, with `locked` carried across rather
     * than inferred from a missing cover — an unlocked album with no cover yet
     * looks identical from the outside and is not private.
     *
     * Asserted against the file rather than a slice of it: `indexOf('return (')`
     * finds the error branch near the top, which is how this came back empty
     * and passed nothing on the way in.
     */
    expect(PERSON).toMatch(/locked: album\.locked,/);
    expect(PERSON).toMatch(/locked: false,/);
  });
});

/**
 * Asking people in, which is the half of "private" the app could not do.
 *
 * Private means added or let in, and only the second existed here: send the
 * link, wait to be asked, answer. So an app-only account could make a private
 * album that nobody could get into except by knocking on it.
 */
describe('adding people to an album', () => {
  const PICKER = read('src/InvitePeople.tsx');

  it('says that picking somebody asks them rather than adds them', () => {
    /*
     * The rule the screen has to say out loud, because "Add" reads as done:
     * the route writes an `open` invitation and accepting is what grants
     * access. A host who could add people outright would be writing their
     * guest list into somebody else's account.
     */
    expect(PICKER).toMatch(/Nobody is put into an album by somebody else/);
    expect(PICKER).toMatch(/They are asked, and they answer/);
  });

  it('reports the count the server returned, not the number it sent', () => {
    // The route drops anybody it will not write and refuses to say which.
    expect(PICKER).toMatch(/const \{ invited \} = await api\.invite\(/);
    expect(PICKER).toMatch(/Asked \$\{invited\}/);
  });

  it('leaves who may be asked to the server', () => {
    /*
     * `/api/people` already hides each of two people from the other after a
     * block, and the route checks again per person before it writes anything.
     * A list assembled in the client would be a second copy of that decision,
     * in the one place that cannot enforce it.
     *
     * Asserted as the api surface this file touches rather than by searching
     * for the word: the header explains why blocks are not filtered here, and
     * a test that cannot tell the explanation from the mistake fails on its
     * own documentation.
     */
    // `api\n  .friends()` is one call written across two lines, so the
    // whitespace has to be part of the pattern.
    const used = [...PICKER.matchAll(/\bapi\s*\.\s*([a-zA-Z]+)\(/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(new Set(used)).toEqual(new Set(['friends', 'findPeople', 'invite']));
  });

  it('debounces the search rather than spending a request per keystroke', () => {
    // What is behind it walks the account table.
    expect(PICKER).toMatch(/SEARCH_DELAY_MS/);
    expect(PICKER).toMatch(/q\.length < 2/);
  });

  it('holds the choice on the create screen and sends it on the event screen', () => {
    /*
     * The same picker, opposite behaviour, and that is why `picked` is the
     * caller's: backing out of the create form asks nobody, where a picker
     * that sent as it went would leave a trail of invitations to an event that
     * was never made.
     */
    expect(CREATE).toMatch(/<InvitePicker[\s\S]{0,120}picked=\{invitees\}/);
    expect(CREATE).toMatch(/api\s*\n?\s*\.invite\(/);
    expect(PICKER).toMatch(/export function InviteCard/);
    expect(APP).toMatch(/<InviteCard api=\{api\} t=\{t\} eventId=\{event\.id\}/);
  });

  it('offers it on the event screen only to somebody who can administer', () => {
    // A host's guest list, not a way for anybody in an album to pull people
    // into it — the same gate the route applies.
    expect(APP).toMatch(/const host = feed\?\.event\.canAdminister === true;/);
    expect(APP).toMatch(/\{host && <InviteCard/);
  });
});

/**
 * Who can add photographs, on a phone.
 *
 * The same three answers the website asks, in the same words, in the two
 * places it asks them — a phone and a browser describing one setting
 * differently is two products.
 */
describe('who can add photos', () => {
  const CHOICE = read('src/ContributeChoice.tsx');
  const CREATE = read('src/CreateEvent.tsx');

  it('is asked when the album is made and again in its settings', () => {
    /*
     * It was asked in neither. Every album accepted everybody's photographs,
     * and the only lever was a switch on the web's manage screen that turned
     * uploading off for everyone including the host.
     */
    expect(CREATE).toMatch(/<ContributeChoice/);
    expect(CREATE).toMatch(/contributePolicy: contribute,/);
    expect(APP).toMatch(/<ContributeChoice/);
    expect(APP).toMatch(/api\.setContributePolicy\(event\.id, value\)/);
  });

  it('says the same things the website says, in the same order', () => {
    const WEB = readFileSync(
      fileURLToPath(new URL('../../web/app/components/ContributeChoice.tsx', import.meta.url).href),
      'utf8',
    );
    for (const label of ['Everyone', 'Members', 'Only me', 'Hosts']) {
      expect(CHOICE, label).toContain(`label: '${label}'`);
      expect(WEB, label).toContain(`label: '${label}'`);
    }
    // "Nobody, including you" is offered by neither any more. See
    // `CONTRIBUTE_NOBODY`; the value still exists and nothing writes it.
    for (const source of [CHOICE, WEB]) {
      expect(source).not.toContain("label: 'Nobody'");
    }
    // And each says what happens rather than what the setting is called.
    expect(CHOICE).toMatch(/You add the photographs and everybody else comes to look/);
    expect(CHOICE).toMatch(/Anybody else in the album can ask to be one/);
  });

  it('asks the question in the words the other setting makes true', () => {
    /*
     * "Who can see it" and "who can add" compose, and the second used to
     * defer to the first in prose — "anyone who can see the album" — which
     * left somebody to work out the composition themselves. The answer is
     * named instead: on a private album the people who can see it are its
     * members, so the pill says Members.
     *
     * And the order turns on it too. A public album's ordinary answer is that
     * whoever turns up can add; a private one's is that the album is somebody's
     * and the members are the exception. Whichever leads reads as the default,
     * so it must be the right one for the album in front of you.
     */
    expect(CHOICE).toMatch(/export function contributeOptions\(accessPolicy: string\)/);
    expect(CHOICE).toMatch(/const PUBLIC_OPTIONS[\s\S]*?label: 'Everyone'/);
    expect(CHOICE).toMatch(/const PRIVATE_OPTIONS[\s\S]*?label: 'Only me'/);
    // Both screens hand over the live choice rather than a saved one.
    expect(CREATE).toMatch(/accessPolicy=\{isPrivate \? 'private' : 'public'\}/);
    expect(APP).toMatch(/accessPolicy=\{visible\}/);
  });

  it('answers the press before the server does, and defers afterwards', () => {
    /*
     * The trick the visibility pills already use: one round trip is long
     * enough for a tap to feel ignored, so the choice is held locally and
     * dropped the moment a feed lands. Null means "whatever the server says",
     * which is the state on every load and after every refresh.
     */
    expect(APP).toMatch(/const \[adding, setAdding\] = useState<ContributePolicy \| null>\(null\)/);
    expect(APP).toMatch(/adding=\{adding \?\? feed\?\.event\.contributePolicy \?\? 'everyone'\}/);
    expect(APP).toMatch(/setPolicy\(null\);\s*\n\s*setAdding\(null\);/);
  });

  it('dims the add button on the server’s answer about this reader', () => {
    /*
     * It read `uploadsOpen`, which is a fact about the album and the same for
     * everybody. On a host-only album that would offer the button to all of
     * them and refuse it on the way up — the shape of failure that teaches
     * people the app is unreliable rather than that the album is closed.
     *
     * Left enabled while the feed is still arriving: a control that starts
     * disabled and enables itself is a control somebody has already decided
     * does not work.
     */
    expect(APP).toMatch(/disabled=\{feed \? !feed\.canAdd : false\}/);
    // Comments stripped: the note beside the button names the field it
    // replaced, and prose about a property is not a read of one.
    expect(code(APP)).not.toMatch(/uploadsOpen/);
    expect(read('src/api.ts')).toMatch(/canAdd: boolean;/);
  });
});
