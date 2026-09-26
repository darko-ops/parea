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
/** Where the notification handler and the Android channel are set up. */
const PLATFORM = read('src/platform.ts');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the door', () => {
  it('is a disc in the head row, not a tab', () => {
    /*
     * The tab bar is four entries and stays four. A notification tab would be
     * a permanent quarter of it spent on a screen that is usually empty, which
     * is the trade `Requests.tsx` refused and this does not reopen.
     */
    /*
     * A tray rather than an envelope. An envelope is one thing arriving
     * addressed to you; half of what lands in Lately is addressed to nobody —
     * photographs added to an album you are in, an answer to something you
     * asked. A tray is where all of it accumulates.
     */
    expect(HEAD).toMatch(/<Glyph name="tray"/);
    // And the screen it opens is illustrated with the same picture. A disc
    // showing one thing that opens a screen showing another is two screens as
    // far as anybody can tell.
    expect(LATELY).toMatch(/<Glyph name="tray"/);
    expect(code(APP)).not.toMatch(/type Tab = [^;]*'lately'/);
    expect(APP).toMatch(/type Tab = 'home' \| 'chats' \| 'search' \| 'profile'/);
  });

  it('is opposite the making, on the tabs that make more than one thing', () => {
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
    /*
     * Two of the three now, and the one it left is the one it was least
     * useful on. Chats holds a `+` in that corner instead: a tab whose whole
     * subject is groups makes one, and the tray is a thing that came to you
     * rather than a thing you open your conversations to find.
     *
     * Home and Find keep it, so "somebody is waiting on you" is still one
     * press from the tab anybody opens the app on.
     */
    expect(EVENTS.match(/right=\{<Notifications t=\{t\} count=\{waiting\} unread=\{unread\} onPress=\{onOpenLately\} \/>\}/g) ?? [])
      .toHaveLength(2);
    // And the corner it vacated is not empty — it is the thing that tab makes.
    const CHATS = EVENTS.slice(EVENTS.indexOf('export function ChatsTab'), EVENTS.indexOf('function ConversationLine'));
    expect(CHATS).toMatch(/right=\{\s*<RoundButton t=\{t\} onPress=\{onCreateChat\} accessibilityLabel="New chat">/);
    expect(CHATS).not.toMatch(/Notifications/);
    /*
     * Two tabs still ask which of the two things you meant, and on those the
     * `+` keeps the leading corner opposite the tray. Chats asks nothing — it
     * makes a group — so its `+` is the corner the tray left, and there is no
     * left-hand control to order against.
     */
    expect(EVENTS.match(/accessibilityLabel="New album or group"/g) ?? []).toHaveLength(2);
    for (const tab of ['HomeTab', 'SearchTab']) {
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
    expect(HEAD).toMatch(/\{count > 0 \? \(/);
    expect(HEAD).toMatch(/\{count > 99 \? '99\+' : count\}/);
    expect(HEAD).toMatch(/badge: \{[\s\S]{0,240}minWidth: 19/);
    expect(HEAD).toMatch(/borderColor: t\.bg/);
  });

  it('falls back to a dot for news nobody can answer', () => {
    /*
     * Almost everything this product notifies about is not a job — a remark
     * under your photograph, a tag, an album filling up — so none of it ever
     * reached the count, and the tray stayed blank through all of it. A push
     * arrived, was missed, and left no mark anywhere in the app.
     *
     * A dot rather than a number, because counting things nobody can act on
     * makes the badge a measure of volume, and a number that only goes down
     * when you look is a number that stops meaning anything.
     */
    expect(HEAD).toMatch(/\) : unread \? \(/);
    expect(HEAD).toMatch(/styles\.badge, styles\.dot/);
    // The same fill and the same ring as the pill: one badge making a smaller
    // claim, not a second kind of urgency in a second colour.
    expect(HEAD).toMatch(/styles\.dot[\s\S]{0,200}backgroundColor: t\.news, borderColor: t\.bg/);
    // And a screen reader is told which of the two it is looking at.
    expect(HEAD).toMatch(/'Lately, something new'/);
  });

  it('wears the logo blue, and puts the dot in the low corner', () => {
    /*
     * `news`, not `accent`. Accent is what a button is, and the tray had been
     * wearing it — so the one control in the corner that says *something
     * arrived* was the same blue as every control that says *press me*.
     *
     * The ink goes dark with it, and that is not a taste: the aqua is a light
     * value, and white on it is 2.3:1, which at 11.5 points is a number nobody
     * can read.
     *
     * The dot sits bottom-right where the count sits top-right. A 19pt pill
     * hanging off the bottom of a disc collides with the row below it; an 11pt
     * dot does not, and the tray glyph is a shallow box whose lower corner is
     * the empty one.
     */
    expect(HEAD).toMatch(/backgroundColor: t\.news, borderColor: t\.bg \}\]\}>/);
    expect(HEAD).toMatch(/styles\.badgeCount, \{ color: t\.onNews \}/);
    expect(HEAD).toMatch(/dot: \{[\s\S]{0,160}bottom: -1, right: -1/);
    expect(HEAD).not.toMatch(/t\.accent/);
  });

  it('marks the Chats tab when something is waiting to be read', () => {
    /*
     * The tab bar was the one place that could have said "there is something
     * to read in here" and the only place that did not know: the per-room
     * counts come from `myGroupsDetailed`, which is the call that tab makes
     * when somebody opens it.
     *
     * A dot, hung off a box the size of the glyph. The four tabs are evenly
     * spaced, so a mark that took width would move the tab it is on — the bar
     * would shift under a thumb the moment a message arrived.
     *
     * Bare, and the same blue as every other mark. A ring on an eleven-point
     * dot was four of the eleven — most of the mark — and in the dark scheme
     * it read as a black circle drawn round it rather than as the bar showing
     * through. A second hue was tried here and said the wrong thing: that this
     * is a different *kind* of alert, which is a distinction the app does not
     * make.
     */
    expect(APP).toMatch(/\{id === 'chats' && chats && \(/);
    expect(APP).toMatch(/styles\.tabDot, \{ backgroundColor: t\.news \}/);
    expect(APP).toMatch(/tabGlyph: \{ width: 22, height: 22/);
    expect(APP).toMatch(/tabDot: \{\s*position: 'absolute'/);
    // No ring at all, and none smuggled back in as a border colour.
    const at = APP.indexOf('tabDot: {');
    const dotRule = APP.slice(at, APP.indexOf('},', at));
    expect(dotRule).not.toMatch(/borderWidth|borderColor/);
    // Said to a screen reader, which cannot see a dot.
    expect(APP).toMatch(/`\$\{label\}, something new`/);
    // And it comes off the same answer the tray does, rather than a second
    // request for a second boolean.
    expect(API).toMatch(/chats: answer\.chats \?\? false/);
    expect(APP).toMatch(/setChats\(next\.chats\)/);
  });

  it('paints every unread mark in one colour', () => {
    /*
     * One colour for arriving, across the whole app: the tray's badge and its
     * dot, the dot on the Chats tab, every count on a conversation. One
     * constant, so there is no way for a screen to be added wearing something
     * else — which is how `accent` came to be doing this job in the first
     * place.
     *
     * The hue is the mark's: `blueOnMint` is 189° and so is this, to within a
     * degree. The chroma is not, and that is deliberate rather than drift. On
     * the logo the aqua is a region two hundred points across and a muted value
     * is what keeps the mark quiet; a notification dot is eight points wide on
     * frosted glass, and at that size the same colour is a grey-blue smudge.
     * Chroma is what survives being small.
     */
    expect(APP).toMatch(/const NEWS: string = '#[0-9a-f]{6}'/);
    // Both schemes, one value — and the ink dark in both, because the aqua is
    // a light value whatever the page behind it is doing.
    expect(APP.match(/news: NEWS, onNews: ON_NEWS,/g) ?? []).toHaveLength(2);
    // One, and no second unread colour beside it. A hue that means a different
    // kind of alert is a distinction this app does not make.
    expect(APP).not.toMatch(/const SAID/);
    // The conversation rows, which are the counts somebody actually reads.
    expect(EVENTS).toMatch(/styles\.unreadDot, \{ backgroundColor: t\.news \}/);
    expect(EVENTS).toMatch(/styles\.unreadPill, \{ backgroundColor: t\.news \}/);
    expect(EVENTS).toMatch(/styles\.unreadCount, \{ color: t\.onNews \}/);
    // And the tray, which is the other corner of the same screen.
    expect(HEAD).toMatch(/backgroundColor: t\.news, borderColor: t\.bg \}\]\}>/);
  });

  it('moves the mark when a notification lands, and on the way back in', () => {
    /*
     * The count only ever moved on launch and on the way out of Lately, so a
     * push that arrived while the app was open drew its banner and changed
     * nothing underneath it — and one that arrived while the app was not
     * running reached no listener at all.
     */
    expect(APP).toMatch(/onNotificationReceived\(\(\) => void refreshWaiting\(\)\)/);
    expect(APP).toMatch(
      /AppState\.addEventListener\('change', \(next\) => \{\s*if \(next === 'active'\) void refreshWaiting\(\);/,
    );
    // Both unsubscribed, or a remount leaves a listener behind holding the
    // last render's callback.
    expect(APP).toMatch(/unheard\(\);/);
    expect(APP).toMatch(/awake\.remove\(\);/);
  });

  it('keeps the app icon on the same count as the tray', () => {
    /*
     * The tray is only visible to somebody who has already opened the app,
     * which is the one person who did not need telling. The icon is what
     * reaches a phone that was face down when the banner came and went.
     */
    expect(APP).toMatch(/void setAppBadge\(next\.waiting > 0 \? next\.waiting : next\.unread \? 1 : 0\)/);
    // And the handler has to be allowed to set one at all, or nothing above
    // ever draws.
    expect(PLATFORM).toMatch(/shouldSetBadge: true/);
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
    expect(API).toMatch(/async waiting\(\): Promise<Waiting>/);
    expect(API).toMatch(/'\/api\/invites'/);
    // Two fields, and a malformed answer is zeroes rather than a throw: every
    // caller treats this as decoration.
    expect(API).toMatch(/waiting: answer\.waiting \?\? 0,/);
    expect(API).toMatch(/unread: answer\.unread \?\? false,/);
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
