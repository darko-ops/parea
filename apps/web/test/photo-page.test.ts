/**
 * A photograph is a page, and the column beside it is the album's chat.
 *
 * Two separate things are being defended here and both are the kind that
 * typecheck, render, and are wrong.
 *
 * The first is the route itself. A single photo became linkable — `Back`, a
 * shared URL and the browser's own history all come from that — and the way
 * that gets undone is somebody reaching for a modal again, because a modal is
 * the shorter thing to write. Nothing else fails when a tile stops being a
 * link: the picture still opens.
 *
 * The second is what the conversation *is*. The design this was built from
 * asked for per-photo comments; the product asks for the album's group chat,
 * on the reasoning that comments-under-a-picture is the shape of a feed and
 * splits one group of people into a hundred dead ends. The difference between
 * the two is one `photoId` in a POST body, invisible in a screenshot, and it
 * changes what the product is.
 *
 * Source checks because there is no DOM in this suite; they stand in for the
 * browser run that actually confirmed the page, and they catch it being
 * quietly taken apart.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const read = async (path: string) =>
  stripComments(await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const ROUTE = await read('../app/event/[id]/p/[photoId]/page.tsx');
const VIEW = await read('../app/components/PhotoView.tsx');
const TILE = await read('../app/components/PhotoTile.tsx');
const EVENT = await read('../app/components/EventView.tsx');

describe('the photo is a page', () => {
  it('is reached by a link from the gallery, not by opening a dialog', () => {
    expect(TILE).toMatch(/<a\s+className="tile-open"/);
    expect(TILE).toMatch(/href=\{href\}/);
    expect(EVENT).toMatch(/href=\{`\/event\/\$\{eventId\}\/p\/\$\{photo\.id\}`\}/);
  });

  it('leaves nothing of the dialog behind', () => {
    // The failure this guards is a half-migration: the route exists, the tile
    // links to it, and the old modal is still mounted underneath — so the
    // gallery navigates *and* opens a dialog, or does neither depending on
    // which handler won.
    expect(EVENT).not.toMatch(/PhotoLightbox|openPhoto/);
  });

  it('keeps selection mode from navigating away', () => {
    // While picking, a tap ticks the photograph. Without the prevented
    // default the first tile somebody tries to select takes them off the
    // gallery they were selecting from.
    expect(TILE).toMatch(/preventDefault\(\)/);
    expect(TILE).toMatch(/picking/);
  });

  it('does not put the photograph in a preview card', () => {
    /*
     * No `og:image`, deliberately, and against the design's ask.
     *
     * This URL is not the credential — access is the capability cookie or the
     * link exchange — so a preview image would hand the photograph to
     * whatever service unfurls a pasted URL, and to everybody in the chat it
     * was pasted into, none of whom passed the gate.
     */
    expect(ROUTE).not.toMatch(/openGraph|og:image/);
  });
});

describe('the column beside it', () => {
  it('is the album thread, whole', () => {
    // The same component the Conversation tab draws, handed the same
    // messages. Not a list narrowed to this picture.
    expect(VIEW).toMatch(/<Thread/);
    expect(VIEW).toMatch(/messages=\{thread\}/);
  });

  it('is not narrowed to this photograph', () => {
    /*
     * The tell for a comment section is a `photoId` passed to the thread —
     * either as a prop it filters on or as an anchor it posts with. `photoId`
     * appears elsewhere in this file, on the safety actions, which are about
     * the one photograph and rightly so; this looks at the element itself.
     */
    const thread = VIEW.match(/<Thread[\s\S]*?\/>/)?.[0] ?? '';
    expect(thread).not.toBe('');
    expect(thread).not.toMatch(/photoId/);
  });

  it('posts to the album rather than anchoring to the picture', async () => {
    // `Thread` sends `{ body }` and nothing else. A `photoId` in that request
    // is what files a message under one photograph — the whole difference
    // between a group chat and a comment section, and one word wide.
    const thread = await read('../app/components/Thread.tsx');
    expect(thread).toMatch(/JSON\.stringify\(\{\s*body\s*\}\)/);
  });

  it('has no per-photo comment component left to fall back to', async () => {
    // Deleted rather than left unused. An unused component is one the next
    // screen imports because it is there and it looked right.
    await expect(read('../app/components/PhotoComments.tsx')).rejects.toThrow();
  });

  it('re-reads the thread from the messages route, not the whole feed', () => {
    // The feed signs a URL for every photograph in the album. Polling it to
    // find out what somebody typed is two hundred signatures for one line of
    // text, on the page that is showing one photo.
    expect(VIEW).toMatch(/\/api\/events\/\$\{event\.id\}\/messages/);
  });
});

describe('the safety actions', () => {
  it('are one press from the photograph', () => {
    // Guideline 1.2 asks for reachable, not prominent. A visible `···` next
    // to the picture is reachable; a submenu or a second page is not.
    expect(VIEW).toMatch(/<Menu[\s\S]*?glyph="···"/);
    expect(VIEW).toMatch(/Report/);
    expect(VIEW).toMatch(/That&rsquo;s me — take it down/);
  });

  it('keep the ownership split', () => {
    // Taking your own photograph back is not a moderation event: no
    // confirmation, no reason asked. Somebody else's gets the three things you
    // might legitimately want instead.
    expect(VIEW).toMatch(/mine \?/);
    expect(VIEW).toMatch(/Remove my photo/);
    expect(VIEW).toMatch(/Yours\. Nobody has to approve this\./);
  });

  it('still ask twice before a block', () => {
    expect(VIEW).toMatch(/Block this person/);
    expect(VIEW).toMatch(/Block — hide all their photos/);
    expect(VIEW).toMatch(/confirming/);
  });

  it('say what happened, in the words the product already used', () => {
    // These are the only account somebody gets of what became of a report they
    // made, and the 48 hours is a commitment the takedown job keeps.
    expect(VIEW).toContain(
      'Asked the host to take it down. If they have not answered in 48 hours it is hidden automatically.',
    );
    expect(VIEW).toContain('Reported. Someone will look at it.');
    expect(VIEW).toContain(
      'Blocked. You will not see their photos any more. They are not told, and nobody else is affected.',
    );
  });
});

describe('paging through the album', () => {
  it('does not hijack the arrow keys out of the composer', () => {
    // The conversation is a text box on the same screen. Without this, a left
    // arrow while editing a message navigates to another photograph
    // mid-sentence.
    expect(VIEW).toMatch(/TEXTAREA/);
    expect(VIEW).toMatch(/ArrowLeft/);
  });

  it('warms the neighbours so a step does not flash an empty frame', () => {
    expect(VIEW).toMatch(/new Image\(\)/);
  });

  it('centres the filmstrip by arithmetic', () => {
    // `scrollIntoView` scrolls every scrollable ancestor to suit itself, which
    // here means the window jumping down to the strip on arrival — past the
    // photograph somebody just opened.
    expect(VIEW).toMatch(/scrollLeft/);
    expect(VIEW).not.toMatch(/scrollIntoView/);
  });
});
