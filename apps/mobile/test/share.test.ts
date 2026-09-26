/**
 * Sending the link from inside an event.
 *
 * It was not possible: the link appeared once, on the screen that made the
 * event, and after that the only way to get it in front of somebody was to
 * make another event. Everything else about an event is reachable from the
 * event; this was the exception, and it is the one thing an event is for.
 *
 * Asserted against the source — the screen imports Expo modules at module
 * scope and needs a device, which is the boundary `api.test.ts` documents.
 * What is checked here is the two decisions, not the layout.
 *
 * ## The system sheet, and why it is gone
 *
 * This file used to assert `Share.share`, on the argument that the OS sheet
 * knows which group chat these people use and picking somebody in it tells
 * this app nothing about who they are. Both halves are still true, and the
 * second one still governs: there is no contact list of our own anywhere in
 * this product, and the assertions below keep it that way.
 *
 * What changed is the first half. The sheet is slower than the thing it
 * replaces, it covers the screen, and where it puts the link depends on a grid
 * of icons that is different on every phone. The common case is somebody with
 * a conversation already open who wants the link in their hand. So the tap
 * copies, and the only thing the app learns is still nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');

const screen = app.slice(app.indexOf('function EventScreen('));

describe('sharing an event from the event', () => {
  it('puts the link on the clipboard, and asks nobody who to send it to', () => {
    expect(screen).toMatch(
      /Clipboard\.setStringAsync\(`\$\{webBase\}\/e\/\$\{event\.linkToken\}`\)/,
    );
    // The rule the system sheet was keeping: this app never learns, stores or
    // draws a list of the people somebody might send it to.
    expect(app).not.toMatch(/expo-contacts|Contacts\./);
  });

  it('says that it copied', () => {
    /*
     * A clipboard is not a place anybody can look. A copy with no visible
     * consequence is indistinguishable from a button that did nothing, and
     * somebody who cannot tell taps it again and pastes into whatever they
     * were writing.
     */
    expect(screen).toMatch(/setCopied\(true\)/);
    expect(screen).toMatch(/setTimeout\(\(\) => setCopied\(false\)/);
    expect(app).toMatch(/copied \? 'Link copied' : 'Copy link'/);
  });

  it('sends the link and nothing else', () => {
    /*
     * No name alongside it: a shared link unfurls into a card carrying the
     * event's title, so putting it in the text as well says it twice. And no
     * spoken phrase — that is the other door, for somebody in the room.
     */
    const at = screen.indexOf('Clipboard.setStringAsync(');
    expect(screen.slice(at, at + 200)).not.toMatch(/event\.name|code|phrase/);
  });

  it('takes the host it should link to rather than guessing one', () => {
    // A link built from the API base is a link that works wherever this build
    // points; one built from a constant is a link to production in a test app.
    expect(screen).toMatch(/webBase: string;/);
    expect(app).toMatch(/<EventScreen[\s\S]{0,1000}webBase=\{API_BASE\}/);
  });
});

/**
 * And the screen that makes an album, which no longer shares anything.
 *
 * Posting used to land on a sheet about the link — the URL, a Copy button, "Send
 * it to everyone who was there" — with the new album dimmed behind it. The
 * argument was that sending the link is the most important moment in the
 * product, which is true, and it was still the wrong place: somebody who has
 * just chosen photographs and pressed Post is going to the album.
 *
 * It was also a bug. `onCreated` fired from that sheet's one link and nowhere
 * else, so the photographs chosen two screens earlier were not sent until
 * somebody tapped through it — and anybody who swiped it away, or pressed Copy
 * and went back, got an album with nothing in it.
 *
 * What has to survive is the part above: the link is still reachable, from the
 * album's own `⋯`, which is where somebody looks for it a day later anyway.
 */
describe('the create screen no longer shares at all', () => {
  const create = readFileSync(
    fileURLToPath(new URL('../src/CreateEvent.tsx', import.meta.url)),
    'utf8',
  );

  it('draws no sheet, and builds no link', () => {
    expect(create).not.toMatch(/Share\.share/);
    expect(create).not.toMatch(/Clipboard/);
    // It has no host to build one from any more, which is the structural half
    // of the same fact: a screen that cannot make a link cannot show one.
    expect(create).not.toMatch(/webBase/);
  });

  it('goes to the album as soon as the album exists', () => {
    /*
     * The fix for the photographs, and the reason this is the same test: the
     * only path that sent them was the sheet's link, so the sheet going away is
     * what makes Post send them.
     */
    expect(create).toMatch(/onCreated\(\s*\{\s*id: created\.id/);
    expect(create).not.toMatch(/setMade|const \[made/);
  });

  it('still does not wait on the invitations', () => {
    // Going to the album must not queue behind a round trip that is about
    // somebody else's Events tab.
    expect(create).toMatch(/void api\s*\n?\s*\.invite\(/);
  });
});
