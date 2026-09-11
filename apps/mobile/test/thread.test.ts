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
    // "Nothing said yet" describes the state somebody can already see.
    const empty = THREAD.slice(
      THREAD.indexOf('<View style={styles.empty}>'),
      THREAD.indexOf('<FlatList'),
    );
    expect(empty).toMatch(/Talk about the moment/);
    expect(empty).toMatch(/Ask for a missing photo/);
    // Not a report of the state somebody can already see.
    expect(empty).not.toMatch(/No messages|Nothing said yet|nothing here/i);
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
