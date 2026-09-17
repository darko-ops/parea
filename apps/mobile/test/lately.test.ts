/**
 * Lately on the phone, and the two arguments it settles.
 *
 * **Why it is a screen and not a fourth tab.** `Requests.tsx` made the opposite
 * case and was right at the time: three tabs is the whole of this app's
 * navigation, and a fourth carrying a list that is usually empty costs a
 * permanent quarter of the tab bar. What changed is that the list stopped being
 * only requests — the feed underneath is most of it, and a feed has nowhere to
 * live in a bubble. So the door is a disc in the Groups heading row, beside the
 * one already there, and the badge is the whole notification surface.
 *
 * **Why the words come from the server.** Every relative time and every day
 * heading arrives composed. A device's clock is a setting, and a phone in the
 * wrong timezone would draw a feed whose headings disagree with the one the
 * same person saw in a browser ten minutes earlier.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const API = read('src/api.ts');
const LATELY = read('src/Lately.tsx');
const EVENTS = read('src/Events.tsx');
/** The head row every tab opens with, and the disc that opens Lately. */
const HEAD = read('src/PageHead.tsx');
/* The bubble on Home is gone; what survives of that file is the vocabulary. */
const ANSWERS = read('src/answers.ts');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the door', () => {
  it('is a disc in the head row, not a tab', () => {
    /*
     * The tab bar is four entries and stays four. A notification tab would be
     * a permanent quarter of it spent on a screen that is usually empty, which
     * is the trade `Requests.tsx` refused and this does not reopen.
     */
    expect(HEAD).toMatch(/<Glyph name="envelope"/);
    expect(code(APP)).not.toMatch(/type Tab = [^;]*'lately'/);
    expect(APP).toMatch(/type Tab = 'home' \| 'chats' \| 'search' \| 'profile'/);
  });

  it('is in the same corner of every tab, not only the one that listed it', () => {
    /*
     * It lived on Groups alone, which is where the asks happened to be listed
     * rather than where somebody would look for them: the one control in the
     * product that says *somebody is waiting on you* was behind a tab you had
     * to already be on.
     *
     * Opposite the `+` on all three. Making is the thing you came to do,
     * answering is the thing that came to you, and one corner each is what
     * stops either from being hunted for.
     */
    expect(EVENTS.match(/right=\{<Notifications t=\{t\} count=\{waiting\} onPress=\{onOpenLately\} \/>\}/g) ?? [])
      .toHaveLength(3);
    expect(EVENTS.match(/accessibilityLabel="New album or group"/g) ?? []).toHaveLength(3);
    // And each `+` is the head's `left`, which is the leading corner.
    for (const tab of ['HomeTab', 'ChatsTab', 'SearchTab']) {
      const body = EVENTS.slice(EVENTS.indexOf(`export function ${tab}`));
      const head = body.slice(body.indexOf('<PageHead'), body.indexOf('/>', body.indexOf('right={')));
      expect(head.indexOf('left={'), tab).toBeLessThan(head.indexOf('right={'));
      expect(head.indexOf('New album or group'), tab).toBeLessThan(head.indexOf('right={'));
    }
  });

  it('carries the count, and nothing at zero', () => {
    /*
     * A badge that draws "0" teaches people the number means nothing, and an
     * empty circle is a claim that something is there. The same 19pt pill the
     * rest of the app uses for unread, with the page colour ringing it so it
     * reads as sitting on the disc rather than inside it.
     */
    expect(HEAD).toMatch(/\{count > 0 && \(/);
    expect(HEAD).toMatch(/\{count > 99 \? '99\+' : count\}/);
    expect(HEAD).toMatch(/badge: \{[\s\S]{0,240}minWidth: 19/);
    expect(HEAD).toMatch(/borderColor: t\.bg/);
  });

  it('takes the count from above rather than fetching its own', () => {
    /*
     * It is a fact about the account, not about that tab: the tab unmounts,
     * Lately answers things that change it, and one owner is what keeps those
     * from disagreeing.
     */
    expect(EVENTS).toMatch(/waiting: number;/);
    expect(APP).toMatch(/const \[waiting, setWaiting\] = useState\(0\)/);
    expect(APP).toMatch(/waiting=\{waiting\}/);
  });

  it('asks for a number rather than counting a list', () => {
    // The badge is drawn on a tab somebody may never open. Fetching fifty rows
    // to render one digit is fifty rows of somebody's data allowance.
    expect(API).toMatch(/async waiting\(\): Promise<number>/);
    expect(API).toMatch(/'\/api\/invites'/);
  });

  it('re-reads the count on the way out, because looking clears it', () => {
    /*
     * `/api/activity` moves `invites_seen_at` as a side effect of answering, so
     * the count in hand is stale the moment the screen opens. Without this the
     * envelope goes on claiming there is something new until the next launch.
     */
    expect(APP).toMatch(/const leaveLately = useCallback\(\(\) => \{\s*void refreshWaiting\(\);/);
    expect(APP).toMatch(/<SwipeBack onBack=\{leaveLately\}>/);
  });
});

describe('the two halves', () => {
  it('answers first and reads second', () => {
    // Urgency, not time. Somebody is on the other end of the top half.
    const waiting = LATELY.indexOf('Waiting on you');
    const feed = LATELY.indexOf('byDay(items)');
    expect(waiting).toBeGreaterThan(-1);
    expect(feed).toBeGreaterThan(waiting);
  });

  it('draws both answers at the same weight', () => {
    /*
     * Declining is not a lesser action, and a screen that draws it as one is a
     * screen nudging somebody into a room they did not want to be in. The
     * affirmative is filled because it is the common answer, not the right one.
     */
    expect(LATELY).toMatch(/ANSWERS\[request\.kind\]\.yes/);
    expect(LATELY).toMatch(/ANSWERS\[request\.kind\]\.no/);
    expect(LATELY).toMatch(/answer: \{ flex: 1/);
  });

  it('shares the labels with the bubble on Home', () => {
    // A second copy is a screen where declining a group invitation is called
    // something else.
    expect(ANSWERS).toMatch(/export const ANSWERS/);
    expect(LATELY).toMatch(/import \{ ANSWERS \} from '\.\/answers'/);
  });

  it('takes the card away as soon as it is answered, and puts it back if it fails', () => {
    // Either answer settles the question — there is no state in which it
    // should still be sitting there.
    expect(LATELY).toMatch(/setWaiting\(\(list\) => list\.filter\(\(r\) => r\.key !== request\.key\)\)/);
    expect(LATELY).toMatch(/setWaiting\(before\)/);
  });

  it('tells the rest of the app when something is answered', () => {
    /*
     * An accepted invitation is an album on the home screen and possibly a
     * group in the tab underneath, and it is one fewer thing on the badge.
     * None of those are things this screen can see.
     */
    expect(APP).toMatch(/onAnswered=\{\(\) => \{[\s\S]{0,400}void refreshEvents\(\);[\s\S]{0,200}void refreshWaiting\(\);/);
  });
});

describe('who words the times', () => {
  it('is the server, for both the times and the day headings', () => {
    /*
     * A phone in the wrong timezone would draw a feed whose headings disagree
     * with the one the same person saw in a browser ten minutes earlier — and
     * the phone would be the copy nobody notices drifting, because nothing
     * renders both side by side.
     */
    expect(API).toMatch(/bucket: string;/);
    expect(API).toMatch(/when: string;/);
    expect(code(LATELY)).not.toMatch(/new Date\(\)|Date\.now\(\)|toLocaleDateString/);
  });

  it('groups the runs here, because a run changes as rows leave', () => {
    // A heading handed down as a row would sit there over nothing the moment
    // the only line under it was answered away.
    expect(LATELY).toMatch(/function byDay/);
    expect(LATELY).toMatch(/last\.bucket === row\.bucket/);
    // Keyed by the run rather than the word, so a mis-sorted list draws two
    // headings with the same word — visibly wrong, which is what a bug should
    // be — instead of folding distant days together.
    expect(LATELY).toMatch(/key=\{day\.rows\[0\]!\.id\}/);
  });
});

describe('where a row goes', () => {
  it('opens a screen, never a browser', () => {
    /*
     * The server hands down web paths because the web is the client it was
     * written for. A path this cannot map to a screen is a row that does not
     * respond — leaving the app to read a notification about the app is the
     * worst answer available, and `/friends` is the one that would do it.
     */
    expect(LATELY).toMatch(/\^\\\/event\\\/\(\[0-9a-f-\]\{36\}\)\$/);
    expect(LATELY).toMatch(/\^\\\/u\\\/\(\[\^\/\]\+\)\$/);
    expect(code(LATELY)).not.toMatch(/Linking|openURL|WebBrowser/);
  });
});

describe('the kind that could not be answered', () => {
  it('is a group invitation, and now it can', () => {
    /*
     * The server has sent `group_invite` since groups gained invitations. The
     * client's union had three kinds, so the labels table had three keys — and
     * the one ask that arrives from somebody you may not know yet drew a card
     * with no words on its buttons, or threw reading one off `undefined`.
     *
     * The `Record` over the union is what caught it, and is why it stays a
     * `Record` rather than a lookup with a default.
     */
    expect(API).toMatch(/'invite' \| 'friend' \| 'join' \| 'group_invite'/);
    expect(ANSWERS).toMatch(/ANSWERS: Record<PendingRequest\['kind'\]/);
    expect(ANSWERS).toMatch(/group_invite: \{ yes: 'Accept', no: 'Decline' \}/);
    // And its own route: an event invitation and a group invitation are two
    // tables, answered by two endpoints that each decide who may say yes.
    expect(API).toMatch(/case 'group_invite':[\s\S]{0,120}\/api\/group-invites\//);
  });
});
