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

/**
 * The album's Comments tab is a board, and a group's room is a chat.
 *
 * Same thread, same rules, one prop apart. It had been drawn as a messenger
 * in both: your own words in an accent bubble against the right-hand edge, a
 * round arrow to send them, and a box offering to "message everyone in this
 * album" — which a reader arriving on a tab called Comments met as a group
 * chat, and a reader in an actual group met as a sentence about an album.
 */
describe('a board is not a chat', () => {
  const VIEWER = read('src/Thread.tsx');

  it('is one prop, not a second component', () => {
    /*
     * Everything that is hard here — who may post, the tombstones, the
     * mention rules, marking it read — is the same in both rooms, and a
     * second copy of it is a second place for the rules to be wrong.
     */
    expect(VIEWER).toMatch(/export type ThreadShape = 'chat' \| 'board';/);
    expect(VIEWER).toMatch(/shape\?: ThreadShape;/);
    // A chat until somebody says otherwise, and the album is what says so.
    expect(VIEWER).toMatch(/shape = 'chat',/);
    expect(APP).toMatch(/shape="board"/);
    const GROUP = read('src/GroupThread.tsx');
    expect(GROUP).not.toMatch(/shape=/);
  });

  it('takes no sides on a board, whoever wrote it', () => {
    /*
     * A chat sides with the speaker because the side of the screen is how a
     * messenger says who said what. A board knows perfectly well that a
     * comment is yours — the name says "You" — and still draws it in the one
     * column everybody else is in.
     */
    expect(VIEWER).toMatch(/const sided = shape === 'chat' && mine;/);
    const row = between(VIEWER, 'function Row({', 'function People({');
    // Every side-taking style keys off `sided`, and the bubble with it.
    for (const style of ['styles.rowMine', 'styles.saidMine', 'styles.aboutMine', 'styles.chipsMine']) {
      expect(row).toContain(`sided && ${style}`);
    }
    expect(row).toMatch(/\{sided \? \(\s*<View style=\{\[styles\.bubble/);
    // And the name is set like everybody else's, "You" included: with no
    // sides it is the whole of the answer to whose comment this is.
    expect(row).toMatch(/\{mine \? 'You' : message\.author\.name\}\s*<\/Text>/);
  });

  it('says what the box is for in the room it is in', () => {
    /*
     * The placeholder is the one line that tells somebody what they are about
     * to do, and it was wrong in both rooms at once — a group chat that named
     * an album, and a comment board that offered to message everybody.
     */
    expect(VIEWER).toMatch(/placeholder=\{board \? 'Add a comment…' : 'Message the group…'\}/);
    // Gone as a string the box says. It survives in the note above it, which
    // is where a decision that was reversed belongs.
    expect(VIEWER).not.toMatch(/placeholder="Message everyone/);
    expect(VIEWER).not.toMatch(/accessibilityLabel="Message everyone/);
    /*
     * And the round accent disc with an arrow in it is a messenger's control:
     * it means send this to somebody. A comment is not sent anywhere, it is
     * posted where it already is, and the verb is worth spelling.
     */
    expect(VIEWER).toMatch(/board \? styles\.post : styles\.send/);
    expect(VIEWER).toMatch(/<Text style=\{\[styles\.postText, \{ color: t\.accent \}\]\}>Post<\/Text>/);
    // The same height in both, so the composer does not jump between rooms.
    expect(VIEWER).toMatch(/post: \{ height: 38,/);
    expect(VIEWER).toMatch(/send: \{ width: 38, height: 38,/);
  });

  it('names the subject when a board is empty', () => {
    // An empty chat is a room with nobody in it and the nudge is social; an
    // empty comment section sits under a wall of photographs somebody has
    // just scrolled, and the thing to say is about those.
    expect(VIEWER).toMatch(/\? 'Say something about these photographs\.'/);
    expect(VIEWER).toMatch(/: 'Say something before this gets awkward\.'/);
  });

  it('keeps the order, which is not what made it a chat', () => {
    // Oldest at the top and the newest against the box you type in is what
    // every comment section under a photograph does too — and it is what the
    // unread count is counted from.
    expect(VIEWER).toMatch(/inverted/);
    expect(VIEWER).toMatch(/onStartReached=\{onSeen\}/);
  });
});

/**
 * A reaction in the conversation it happened in.
 *
 * The thread showed what people wrote and nothing of what they left on the
 * photographs, so an album five people had reacted all over read as one
 * nobody had answered.
 */
describe('a reaction is a line, not a message', () => {
  const VIEWER = read('src/Thread.tsx');

  it('draws as one quiet centred line', () => {
    /*
     * It belongs to the conversation and is not a turn in it. Drawn as a
     * bubble with an emoji inside, it reads as somebody having said an emoji
     * — and there is nothing here to edit, delete or reply to.
     */
    expect(VIEWER).toMatch(/if \(message\.emoji\) \{/);
    expect(VIEWER).toMatch(/\{mine \? 'You' : message\.author\.name\} reacted \{message\.emoji\}/);
    expect(VIEWER).toMatch(/reacted: \{ textAlign: 'center'/);
  });

  it('returns below the hooks, like the tombstone above it', () => {
    // A row that returns early before them is a render with fewer hooks than
    // the last one, which React refuses outright.
    const row = VIEWER.slice(VIEWER.indexOf('if (message.deleted)'));
    expect(row.indexOf('if (message.emoji)')).toBeGreaterThan(0);
    const before = VIEWER.slice(0, VIEWER.indexOf('if (message.deleted)'));
    expect(before).toMatch(/useCallback|useMemo|useState/);
  });

  it('arrives merged and in order, not as a second list', () => {
    /*
     * The ordering is the whole point of a thread, and two lists interleaved
     * on the phone is the ordering decided twice.
     */
    const FEED = read('../../apps/web/app/api/events/[id]/photos/route.ts');
    expect(FEED).toMatch(/\.\.\.messages,/);
    expect(FEED).toMatch(/\.sort\(\(a, b\) => a\.createdAt\.localeCompare\(b\.createdAt\)\)/);
    const API = read('src/api.ts');
    expect(API).toMatch(/emoji\?: string;/);
  });

  it('carries a stable id, because a reaction has none of its own', () => {
    /*
     * Its primary key is exactly these three columns. Stability matters
     * because the list is keyed by it, and a row that changes identity on
     * every poll re-mounts on every poll.
     */
    const REACTIONS = read('../../apps/web/src/photoReactions.ts');
    expect(REACTIONS).toMatch(/`reaction:\$\{row\.photoId\}:\$\{row\.actorId\}:\$\{row\.emoji\}`/);
  });

  it('carries the photograph it was left on, on a board', () => {
    /*
     * "Ana reacted ❤️ to a photo" is a line about a picture that is not in
     * it. The board is the one place where every reaction in an album is read
     * in order, and it was the one place that would not say which one — so a
     * run of them read as noise, and the person who left one could not find
     * their way back to what they had left it on.
     *
     * The photograph goes where a comment has its author's face: one left
     * edge down the column, and the thing the row is about in the slot that
     * says what a row is about. It opens that photograph, which is the same
     * tap the thumbnail above a comment already takes.
     */
    expect(VIEWER).toMatch(/if \(shape === 'board' && about\) \{/);
    expect(VIEWER).toMatch(/onPress=\{\(\) => onOpenPhoto\?\.\(about\.id\)\}/);
    // The face's own 32 and the row's own 10, so the column has one left edge
    // whatever kind of line is on it — and squared, because that slot holds a
    // person in every other row and a picture in this one.
    expect(VIEWER).toMatch(/reactedRow: \{ flexDirection: 'row', alignItems: 'center', gap: 10 \}/);
    expect(VIEWER).toMatch(/reactedShot: \{ width: 32, height: 32, borderRadius: 8/);
    /*
     * And the centred line stays for the two cases with no picture to show: a
     * chat, where a reaction is about the room, and a board whose feed no
     * longer holds the photograph.
     */
    expect(VIEWER).toMatch(/reacted: \{ textAlign: 'center'/);
  });

  it('draws on the web’s board too, rather than as an empty bubble', () => {
    /*
     * The feed merges reactions into the thread both clients read, and the
     * web's copy never learned the difference: each drew as a message with a
     * face, a name, a time and an empty bubble. Same line, same slot for the
     * photograph, and a link rather than a handler — the middle-click and the
     * Back button come from the element.
     */
    const WEB = read('../../apps/web/app/components/Thread.tsx');
    expect(WEB).toMatch(/if \(message\.emoji\) \{/);
    expect(WEB).toMatch(/className="muted thread-reacted"/);
    expect(WEB).toMatch(/<a href=\{about\.href\} className="thread-reacted-shot"/);
    expect(WEB).toMatch(/`\/event\/\$\{eventId\}\/p\/\$\{photo\.id\}`/);
    const WEB_API = read('../../apps/web/src/messages.ts');
    expect(WEB_API).toMatch(/emoji\?: string;/);
  });

  it('hides the people this viewer has blocked, as the pills do', () => {
    const REACTIONS = read('../../apps/web/src/photoReactions.ts');
    const lines = REACTIONS.slice(REACTIONS.indexOf('export async function reactionLines'));
    expect(lines).toMatch(/from "block" b/);
    // And only reactions on photographs anybody can still see.
    expect(lines).toMatch(/eq\(schema\.photos\.status, 'ready'\)/);
  });
});
