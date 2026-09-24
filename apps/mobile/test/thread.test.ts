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

  it('opens one sheet on a long press: react, then edit, then delete', () => {
    /*
     * It was an `Alert` with Edit and Delete in it, and an alert is the right
     * shape for a question and the wrong one for a row of emoji. It could
     * also only ever be raised on your own rows, which left reacting to
     * somebody else's comment to a `+` pill drawn under every comment in the
     * thread — a bordered control offering to react to a sentence nobody had
     * reacted to, competing with the pills that are somebody's real answer.
     *
     * So holding a row is how every verb it has is reached, and the order is
     * the argument: the reactions first, because answering is what somebody
     * holding a comment usually means, and the verbs that change it
     * underneath, where a destructive one is reached deliberately.
     */
    // Gone as a call. It survives in the note that says why, which is where
    // a reversed decision belongs.
    expect(THREAD).not.toMatch(/^\s*Alert\.alert\(/m);
    expect(THREAD).not.toMatch(/from 'react-native'[\s\S]{0,400}\bAlert,/);
    expect(THREAD).toMatch(/function HeldSheet\(\{/);
    /* The same shell the emoji picker and the photo viewer's sheet use: the
       dim is a sibling under the panel rather than its parent, so nothing
       above can claim a touch before the panel's own controls get it. */
    expect(THREAD).toMatch(/heldShell: \{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' \}/);
    const EMOJI = read('src/Emoji.tsx');
    expect(EMOJI).toMatch(/shell: \{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' \}/);
    expect(THREAD).toMatch(/const open = useCallback\(\(\) => setHeld\(true\), \[\]\);/);
    // `remove` deletes rather than asking again, which is what made the old
    // chain of two alerts.
    const removeFn = between(THREAD, 'const remove = useCallback', 'const mention = useMemo');
    expect(removeFn).toMatch(/await actions\.remove\(id\)/);

    /*
     * Held by anybody who has something to do to it: yours for edit and
     * delete, somebody else's when there is a reaction to leave on it. A row
     * with neither takes no long press, so nothing opens an empty sheet.
     */
    expect(THREAD).toMatch(/const holdable = mine \|\| \(canPost && canReact\);/);
    expect(THREAD).toMatch(/onLongPress=\{holdable \? open : undefined\}/);
    /*
     * Shortened from the 500ms default. This is the only way to reach any of
     * them, and half a second of holding still on a scrolling list is long
     * enough that people let go first and conclude there is nothing there.
     */
    expect(THREAD).toMatch(/delayLongPress=\{320\}/);
    /*
     * And a second way to the same sheet. A long press is invisible to a
     * screen reader and impossible for some people to perform; the actions
     * rotor is where iOS puts the alternative.
     */
    expect(THREAD).toMatch(/label: mine \? 'React, edit or delete' : 'React'/);
    expect(THREAD).toMatch(/actionName === 'longpress'\) open\(\)/);
    /*
     * The consequence sits beside the button rather than in a second panel
     * after it — one sheet, and the thing worth knowing is in front of the
     * decision.
     */
    expect(THREAD).toMatch(/deleteNote="It leaves a gap saying it was deleted\."/);
  });

  it('puts the six and a `+` in that sheet, and the `+` nowhere else', () => {
    /*
     * The six are the ones people react to photographs with, and the `+` is
     * the full grid — ours rather than the system's, because there is no way
     * to ask a phone for its emoji panel specifically. It sits at the end of
     * the six where it used to sit at the end of the pills: the same promise,
     * in the place it is now useful.
     */
    expect(THREAD).toMatch(/\{REACTIONS\.map\(\(emoji\) => \(/);
    expect(THREAD).toMatch(/accessibilityLabel="More emoji"/);
    expect(THREAD).toMatch(/import \{ EmojiPicker \} from '\.\/Emoji';/);
    expect(THREAD).toMatch(/<EmojiPicker\b/);
    /*
     * And the pills are somebody's answer and nothing else: a row of them
     * exists only where there are reactions, never as an empty invitation.
     */
    expect(THREAD).toMatch(/\{message\.reactions\.length > 0 && \(/);
    expect(THREAD).not.toMatch(/accessibilityLabel="Add a reaction"/);
  });

  it('lets somebody take back their own reaction from the line', () => {
    /*
     * A reaction line is not a message: there is no row to tombstone, only a
     * reaction to stop having, so `onDelete` would be the wrong verb. The
     * route is the photo one — `photo_reaction`, which toggles — reached from
     * the line rather than from the pill column.
     */
    expect(THREAD).toMatch(/unreact\?: \(photoId: string, emoji: string\) => Promise<unknown>;/);
    expect(THREAD).toMatch(/onUnreact\?: \(\) => void;/);
    expect(THREAD).toMatch(/deleteLabel="Remove my reaction"/);
    // Only your own, only with a photograph behind it, only where the caller
    // can reach it.
    expect(THREAD).toMatch(
      /item\.emoji && item\.photoId && item\.author\.mine && actions\.unreact/,
    );
    expect(APP).toMatch(/unreact: \(photoId: string, emoji: string\) => api\.reactToPhoto\(photoId, emoji\)/);
    // And nothing to react to on one: a row of emoji over a reaction would
    // offer to react to a reaction.
    expect(THREAD).toMatch(/reactions=\{false\}/);
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
 * The album's Comments tab and a group's room are one drawing.
 *
 * Both had been drawn as a messenger: your own words in an accent bubble
 * against the right-hand edge, a round arrow to send them, and a box offering
 * to "message everyone in this album" — which a reader arriving on a tab
 * called Comments met as a group chat, and a reader in an actual group met as
 * a sentence about an album.
 *
 * The board was rewritten first and the chat followed it a piece at a time,
 * each piece for its own reason. What is left of `shape` is the words: Post
 * against Send, "Add a comment…" against "Message the group…", and two empty
 * lines. The pieces and their reasons are what this pins.
 */
describe('two rooms, one drawing', () => {
  const VIEWER = read('src/Thread.tsx');

  it('is one prop, not a second component', () => {
    /*
     * Everything that is hard here — who may post, the tombstones, the
     * mention rules, marking it read — is the same in both rooms, and a
     * second copy of it is a second place for the rules to be wrong. The prop
     * stays now that it only picks words: a room still has to be able to say
     * which one it is.
     */
    expect(VIEWER).toMatch(/export type ThreadShape = 'chat' \| 'board';/);
    expect(VIEWER).toMatch(/shape\?: ThreadShape;/);
    // A chat until somebody says otherwise, and the album is what says so.
    expect(VIEWER).toMatch(/shape = 'chat',/);
    expect(APP).toMatch(/shape="board"/);
    const GROUP = read('src/GroupThread.tsx');
    expect(GROUP).not.toMatch(/shape=/);
  });

  it('hangs your own from the right, and draws no fill in either room', () => {
    /*
     * Two questions that used to be one. Which edge a block hangs from is
     * seen before a word of it is read, and a column with everybody in it
     * reads as a wall of other people's words with yours buried in it — so
     * the side stays, in both rooms.
     *
     * The fill is what a messenger uses to say who is speaking, and the side
     * already says it. A column of solid blocks is read as traffic; what is
     * in this one is people talking about an evening. The side is an
     * alignment, not a costume.
     */
    expect(VIEWER).toMatch(/const sided = mine;/);
    const row = between(VIEWER, 'export function ThreadRow({', 'function People({');
    for (const style of ['styles.rowMine', 'styles.saidMine', 'styles.aboutMine', 'styles.chipsMine']) {
      expect(row).toContain(`sided && ${style}`);
    }
    expect(VIEWER).not.toMatch(/styles\.bubble|mentionOnAccent/);
    // One treatment for the words, so `@ana` is in the accent in every
    // message rather than marked by weight inside a fill it cannot colour
    // against.
    expect(row).toMatch(/withMentions\(message\.body, \{ color: t\.accent \}\)/);
    expect(row.match(/withMentions\(/g)).toHaveLength(1);
    /*
     * And the block turns round without its lines turning with it:
     * `alignItems`, never `textAlign`. Right-aligned prose over three lines
     * is read a word at a time while the eye hunts for where each begins —
     * three words in a bubble can take that and a paragraph cannot.
     */
    expect(VIEWER).toMatch(/saidMine: \{ alignItems: 'flex-end' \}/);
    expect(between(VIEWER, 'const styles = StyleSheet.create', 'people: {'))
      .not.toMatch(/textAlign: 'right'/);
    // The name is still set like everybody else's, "You" included.
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
     * And the button spells the verb of the room. The round accent disc that
     * was here is a messenger's control — it means send this to somebody,
     * which a message does and a comment does not — and it earned its place
     * beside a pill rather than inside a card. See the composer's own note.
     */
    expect(VIEWER).toMatch(
      /accessibilityLabel=\{board \? 'Post this comment' : 'Send this message'\}/,
    );
    expect(VIEWER).toMatch(/\? 'Posting…'\s*: 'Post'/);
    expect(VIEWER).toMatch(/\? 'Sending…'\s*: 'Send'/);
    // Gone as a control, with the strip it sat on. It survives in the notes
    // that say why, which is where a reversed decision belongs.
    expect(VIEWER).not.toMatch(/styles\.sendGlyph|styles\.send\b/);
  });

  it('draws the site’s own composer in both rooms', () => {
    /*
     * The card the site draws — the field bare inside one bordered box with
     * the button under it — and the same numbers, restated because there is
     * no stylesheet between the clients.
     *
     * In the group's room too. A chat had the strip every messenger has, a
     * pill and a round arrow with a rule over them, and the ↑ disc earns its
     * place beside a pill rather than inside a card. What a reader is told
     * about the room they are in belongs in the words on the button, not in
     * two kinds of furniture — which is how an app ends up with two of
     * everything.
     */
    const CSS = read('../../apps/web/app/globals.css');
    const web = (rule: string) => CSS.slice(CSS.indexOf(rule), CSS.indexOf('}', CSS.indexOf(rule)));
    // The card: a 1-point border at 14, with 13 and 15 of padding and 8 under
    // the field.
    expect(VIEWER).toMatch(
      /card: \{ borderWidth: 1, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15, gap: 8 \}/,
    );
    expect(web('.thread-composer {')).toMatch(/border-radius: 14px; padding: 13px 15px/);
    expect(web('.thread-composer {')).toMatch(/gap: 8px/);
    // The field bare inside it, because the card is the edge.
    expect(VIEWER).toMatch(/field: \{ fontSize: 15, maxHeight: 120, padding: 0 \}/);
    expect(web('.thread-field {')).toMatch(/border: 0; padding: 0/);
    // The actions under it: the error to the left, the button at the edge.
    expect(VIEWER).toMatch(/actions: \{ flexDirection: 'row', alignItems: 'center', gap: 12 \}/);
    expect(web('.thread-actions {')).toMatch(/gap: 12px/);
    expect(VIEWER).toMatch(/note: \{ flex: 1, fontSize: 12\.5/);
    expect(web('.thread-note {')).toMatch(/flex: 1; font-size: 12\.5px/);
    /*
     * And the mention list at the head of the box rather than on a bar over
     * it: what it is doing is finishing the word under the cursor, so it
     * belongs in the same box as the cursor. The site's `.mention-list` is a
     * wrapped row of pills with 6 of gap above its own bottom rule.
     */
    expect(VIEWER).toMatch(/mentions: \{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8, borderBottomWidth: 1 \}/);
    expect(web('.mention-list {')).toMatch(/gap: 6px; flex-wrap: wrap; padding-bottom: 8px/);
    expect(VIEWER).toMatch(/mention: \{ borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 \}/);
    expect(CSS).toMatch(/\.mention-list button \{\s*padding: 5px 10px; border-radius: 999px; font-size: 13px;/);
    // And the button filled, at the site's own size.
    expect(VIEWER).toMatch(/post: \{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10 \}/);
    expect(CSS).toMatch(/\.thread-actions button \{ padding: 9px 16px; font-size: 14px; border-radius: 10px; \}/);
    expect(VIEWER).toMatch(/postText: \{ fontSize: 14, fontWeight: '600' \}/);
    /*
     * And no hairline across the screen in either room: the card has its own
     * edge, and a rule behind it is the strip the card is there instead of.
     */
    expect(VIEWER).toMatch(/composer: \{ paddingTop: 12,/);
    /* The card has its own edge; the only `borderTopWidth` left in the file
       is the held sheet's, which is a sheet and wants one. */
    expect(between(VIEWER, 'composer: { paddingTop: 12,', 'heldShell:')).not.toMatch(
      /borderTopWidth/,
    );
    // One field, one card, one button — the shape reaches the words on the
    // button and nothing else down here.
    expect(VIEWER).not.toMatch(/fieldPill|composerRow/);
    const composer = between(VIEWER, 'One box at the foot of both rooms', 'export function ThreadRow({');
    expect(composer.match(/\{field\}/g)).toHaveLength(1);
    expect(composer.match(/styles\.post,/g)).toHaveLength(1);
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
    expect(VIEWER).toMatch(
      /const said = `\$\{mine \? 'You' : message\.author\.name\} reacted \$\{message\.emoji\}`;/,
    );
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
    /* `about` is the whole of the question: only a caller that hands over a
       `photoOf` has pictures for these lines to be about, which is the album
       and not a group's room. */
    expect(VIEWER).toMatch(/\{about \? \(/);
    expect(VIEWER).toMatch(/onPress=\{\(\) => onOpenPhoto\?\.\(about\.id\)\}/);
    // The face's own 32 and the row's own 10, so the column has one left edge
    // whatever kind of line is on it — and squared, because that slot holds a
    // person in every other row and a picture in this one.
    expect(VIEWER).toMatch(
      /reactedRow: \{\s*flexDirection: 'row',\s*alignItems: 'center',\s*justifyContent: 'center',\s*gap: 10,\s*\}/,
    );
    /*
     * Centred rather than run along the left edge with the comments, which is
     * where it started: that put a thing nobody said on the same edge as the
     * things people did say, and a run of them read as comments with no words
     * in them. Down the middle it is an aside in the conversation, in the
     * same place the plain line has always been.
     */
    expect(VIEWER).toMatch(/reacted: \{ textAlign: 'center'/);
    // And shrunk rather than flexed, or the pair would be justified to both
    // edges instead of centred.
    expect(VIEWER).toMatch(/reactedText: \{ flexShrink: 1, minWidth: 0/);
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
