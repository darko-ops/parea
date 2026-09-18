/**
 * The messenger, which did not exist on native at all.
 *
 * The conversation about an event shipped on the web — `Thread.tsx` — and was
 * absent from the app people actually take to the event. This is the same
 * thread with the same rules, and every rule below is one that was decided on
 * the web and must not be re-decided here: two implementations of "who may
 * post" is how one of them comes to be wrong.
 *
 * Source checks, because there is no renderer in this suite. They stand in for
 * the simulator run and they catch the screen being taken apart.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const THREAD = read('src/Thread.tsx');

/**
 * The text between two anchors, and an error rather than a silent pass when
 * one of them has been renamed.
 *
 * `slice(indexOf(a), indexOf(b))` with a stale anchor is `slice(n, -1)` — the
 * whole rest of the file — so the assertions go on passing while describing
 * something else entirely. That has already happened twice in this suite.
 */
const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  if (end < 0) throw new Error(`anchor not found: ${to}`);
  return source.slice(start, end);
};
const API = read('src/api.ts');
const APP = read('App.tsx');

describe('what it asks the server for', () => {
  it('implies no new server work', () => {
    // Every route here is one the web already talks to. The feature is worth
    // having on native precisely because it is this small.
    expect(API).toMatch(/\/api\/events\/\$\{eventId\}\/messages/);
    expect(API).toMatch(/\/api\/messages\/\$\{messageId\}/);
    expect(API).toMatch(/\/api\/messages\/\$\{messageId\}\/reactions/);
  });

  it('reads the thread off the feed rather than polling it separately', () => {
    /*
     * The server folds messages into the photo feed on purpose: the event
     * screen already re-reads that endpoint, and a second poller would be a
     * second schedule to reason about and twice the requests from a phone in
     * somebody's pocket.
     */
    expect(API).toMatch(/messages: Message\[\]/);
    expect(THREAD).not.toMatch(/setInterval|api\.messages\(/);
    // So every write ends by re-reading the feed rather than keeping a second
    // list in step with it.
    expect(THREAD).toMatch(/await onChanged\(\)/);
  });
});

describe('the rules carried over from the web', () => {
  it('takes “may I post” from the server, never from holding a link', () => {
    /*
     * `contribute` is held by anybody with the link, and posting additionally
     * requires an account. Inferring it here would draw a composer for
     * somebody the server was always going to refuse.
     */
    expect(API).toMatch(/canPost: boolean/);
    expect(APP).toMatch(/canPost=\{feed\?\.canPost \?\? false\}/);
    expect(THREAD).toMatch(/\{canPost \?/);
    expect(THREAD).toMatch(/Only people who can add photos can post/);
  });

  it('leaves a gap where a message was deleted', () => {
    // The ones either side of a silently removed message appear to be
    // answering each other.
    expect(THREAD).toMatch(/Message deleted/);
    expect(THREAD).toMatch(/message\.deleted/);
  });

  it('offers only this event’s contributors in the mention list', () => {
    /*
     * A picker that reaches further is a way to find out who exists by typing
     * letters at it, and this is the one text field in the product that a
     * link-holder can use. `people` is the event's contributor list and the
     * screen passes nothing else into it.
     */
    expect(THREAD).toMatch(/people: Mentionable\[\]/);
    expect(APP).toMatch(/people=\{\(feed\?\.people \?\? \[\]\)/);
    expect(THREAD).toMatch(/\.slice\(0, 5\)/);
  });

  it('marks a mention rather than resolving it', () => {
    /*
     * It says what somebody typed. It does not assert that the person exists,
     * and it cannot be made to render anything but a run of characters that
     * were already going to be shown — which is what keeps a message body from
     * being a place to put markup.
     */
    expect(THREAD).toMatch(/function withMentions/);
    expect(THREAD).toMatch(/body\.split\(/);
    expect(THREAD).not.toMatch(/onPress=\{\(\) => onOpenPerson/);
  });

  it('invites a first message rather than reporting an empty one', () => {
    /*
     * "Nothing said yet" describes the state somebody can already see. One
     * line now, where it was a heading and a paragraph explaining what a
     * conversation is for: nobody needs telling, and what an empty room needs
     * is a reason to say the first thing.
     */
    /*
     * Comments stripped: the note beside this state argues against the
     * sentences it replaced, and prose about a phrase is not the phrase.
     */
    const empty = THREAD.slice(
      THREAD.indexOf('live.length === 0'),
      THREAD.indexOf('<FlatList'),
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(empty).toMatch(/Say something before this gets awkward\./);
    expect(empty).not.toMatch(/Ask for a missing photo/);
    // Not a report of the state somebody can already see.
    expect(empty).not.toMatch(/No messages|Nothing said yet|nothing here/i);
  });

  it('does not claim a thread is empty before it has arrived', () => {
    /*
     * An empty conversation and an unfetched one are the same shape and mean
     * opposite things. Both callers handed over `[]` for both, so opening a
     * conversation said "nothing has been said here" for as long as the
     * request took — and then the conversation appeared underneath the
     * sentence denying it existed.
     *
     * The distinction lives in `Thread` because the thing that has to change
     * is what gets drawn, and only `Thread` draws it.
     */
    expect(THREAD).toMatch(/messages: Message\[\] \| null;/);
    expect(THREAD).toMatch(/\{messages === null \? \(/);
    expect(THREAD).toMatch(/\(messages \?\? \[\]\)\.filter/);
    // The album's Talk pane is the one that was showing it. `feed?.messages ??
    // []` is right for every other reader of that value and wrong for this one.
    const APP = read('App.tsx');
    expect(APP).toMatch(/messages=\{feed \? messages : null\}/);
  });

  it('keeps a group’s thread current while somebody is reading it', () => {
    /*
     * It asked once on mount and then only when the thread was scrolled to the
     * bottom or something was posted, so a message from anybody else arrived
     * whenever the reader happened to move — which from the other side looks
     * like the conversation being minutes behind. The album's thread gets its
     * refreshes from the feed the photographs are already polling; a group has
     * no feed, which is why nothing was doing this.
     */
    const GROUP = read('src/GroupThread.tsx');
    expect(GROUP).toMatch(/setInterval\(\(\) => \{\s*\n\s*if \(AppState\.currentState === 'active'\) void load\(\);\s*\n\s*\}, 4000\)/);
    expect(GROUP).toMatch(/return \(\) => clearInterval\(timer\);/);
    /*
     * Only while the app is in front: a poll that keeps running in somebody's
     * pocket is a request every four seconds for a screen nobody is reading,
     * and the answer would be stale by the time they looked anyway.
     */
    expect(GROUP).toMatch(/import \{ AppState,/);
  });

  it('polls without eating the thread it is polling for', () => {
    /*
     * Three things a poll has to avoid that a one-shot load never did.
     *
     * A slow answer must not overwrite a fast one that came after it, or a
     * message appears and then vanishes for four seconds — the sort of thing
     * people report as "it deleted my message".
     *
     * A tick that found nothing new must not replace the array anyway: every
     * row of an inverted list re-renders when it does, four times a minute,
     * for no change. Ids, bodies and tombstones, because an edit and a delete
     * both move the signature where a length comparison would miss them.
     *
     * And a dropped request must not replace a conversation somebody is
     * reading with "this is not available". That sentence is true of a 404 on
     * the first load and is not worth saying on the strength of one
     * unreachable moment; the next tick says it again if it is true.
     */
    const GROUP = read('src/GroupThread.tsx');
    expect(GROUP).toMatch(/const mine = \+\+asked\.current;/);
    expect(GROUP.match(/if \(mine !== asked\.current\) return;/g) ?? []).toHaveLength(2);
    expect(GROUP).toMatch(/\$\{m\.id\}:\$\{m\.deleted \? 1 : 0\}:\$\{m\.body\}/);
    expect(GROUP).toMatch(/if \(next !== shape\.current\) \{/);
    expect(GROUP).toMatch(/if \(messagesRef\.current === null\) \{/);
  });

  it('offers edit and delete on a long press, in one alert', () => {
    /*
     * It was two native alerts in a row: the menu, and then a "Delete this
     * message?" raised from inside that menu's own dismissal. iOS presents the
     * second on a view controller that is already going away, so it never
     * appeared — you held your message, chose Delete, and nothing happened at
     * all.
     *
     * One alert is the better shape regardless. Long-pressing a message and
     * choosing a red item is already a deliberate act, and the consequence —
     * it leaves a gap rather than vanishing — belongs in front of the decision
     * rather than in a second panel after it.
     */
    expect(THREAD).toMatch(
      /Alert\.alert\('Your message', 'Deleting it leaves a gap saying it was deleted\.', \[/,
    );
    expect(THREAD).toMatch(/text: 'Delete', style: 'destructive', onPress: onDelete/);
    // `remove` deletes rather than asking again, which is what made the chain.
    const removeFn = between(THREAD, 'const remove = useCallback', 'const mention = useMemo');
    expect(removeFn).not.toMatch(/Alert\.alert/);
    expect(removeFn).toMatch(/await actions\.remove\(id\)/);

    /*
     * Only on your own, and only by holding: three dots beside each of your
     * own messages is a permanent invitation to delete them, and on this width
     * it competes with the name and the time for one line.
     */
    expect(THREAD).toMatch(/onLongPress=\{mine \? menu : undefined\}/);
    /*
     * Shortened from the 500ms default. This is the only way to reach either
     * verb, and half a second of holding still on a scrolling list is long
     * enough that people let go first and conclude there is nothing there.
     */
    expect(THREAD).toMatch(/delayLongPress=\{320\}/);
    /*
     * And a second way to the same menu. A long press is invisible to a screen
     * reader and impossible for some people to perform; the actions rotor is
     * where iOS puts the alternative.
     */
    expect(THREAD).toMatch(/accessibilityActions=\{[\s\S]{0,80}label: 'Edit or delete'/);
    expect(THREAD).toMatch(/actionName === 'longpress'\) menu\(\)/);
    // One menu, reached two ways, rather than the alert written out twice.
    expect(THREAD.match(/Alert\.alert\('Your message'/g) ?? []).toHaveLength(1);
  });

  it('keeps the draft when a post fails', () => {
    // Losing what somebody typed because a request failed is the failure mode
    // this is written to avoid: the draft is only cleared after a success.
    // `actions.post` rather than `api.postMessage`: the same component draws a
    // group's thread now, and the two hit different routes. What matters here
    // is unchanged — the draft is cleared only after the await returns.
    expect(THREAD).toMatch(/await actions\.post\(body\);\s*\n\s*setDraft\(''\);/);
  });
});

describe('what is native rather than borrowed', () => {
  it('opens on the newest message without a measuring pass', () => {
    /*
     * An inverted list starts at the bottom by construction, which is the
     * difference between opening on the conversation and watching it jump
     * once after layout. The vocabulary goes upside down with it — reaching
     * the bottom is `onStartReached` — and the behaviour does not.
     */
    expect(THREAD).toMatch(/inverted/);
    expect(THREAD).toMatch(/onStartReached=\{onSeen\}/);
    expect(THREAD).toMatch(/\.reverse\(\)/);
  });

  it('reaching the bottom is what marks it read', () => {
    // The same rule the banner over the cover clears on, and the same one the
    // web's column follows.
    expect(APP).toMatch(/onSeen=\{markRead\}/);
    expect(APP).toMatch(/const markRead = useCallback\(\(\) => \{\s*setSeen\(messages\.length\);/);
    /*
     * And it is now durable as well as local. `seen` clears the banner and the
     * count while this screen is open; the call to the server is what stops
     * the Groups tab listing the same conversation as waiting tomorrow.
     */
    expect(APP).toMatch(/void api\.markEventRead\(event\.id, event\.linkToken\)/);
  });
});
