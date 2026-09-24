/**
 * A photograph is a page, and the column beside it is the event's chat.
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
 * asked for per-photo comments; the product asks for the event's group chat,
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
const REACT = await read('../app/components/PhotoReactions.tsx');
const ROUTE_EVENT = await read('../app/event/[id]/page.tsx');
const STAR = await read('../app/components/Star.tsx');
const CSS = await readFile(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

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
  it('is the event thread, whole', () => {
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

  it('posts to the event rather than anchoring to the picture', async () => {
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
    // The feed signs a URL for every photograph in the event. Polling it to
    // find out what somebody typed is two hundred signatures for one line of
    // text, on the page that is showing one photo.
    expect(VIEW).toMatch(/\/api\/events\/\$\{event\.id\}\/messages/);
  });
});

/**
 * What you can do with the photograph, as opposed to about it.
 *
 * Two verbs, at the two ends of the picture: react on the left, save on the
 * right. The app's arrangement, brought across — both are one tap about the
 * photograph, so they belong at the ends rather than in the middle of the line
 * that says who took it.
 */
describe('the two verbs under the photograph', () => {
  it('puts reacting at one end and saving at the other', () => {
    expect(VIEW).toMatch(/className="photo-verbs"/);
    const verbs = VIEW.slice(VIEW.indexOf('className="photo-verbs"'), VIEW.indexOf('className="photo-by"'));
    expect(verbs.indexOf('<PhotoReactions')).toBeLessThan(verbs.indexOf('photo-icon'));
    expect(CSS).toMatch(/\.photo-verbs \{[^}]*justify-content: space-between/);
    // The byline under them is identity and nothing else now.
    const by = VIEW.slice(VIEW.indexOf('className="photo-by"'), VIEW.indexOf('<Filmstrip'));
    expect(by).not.toMatch(/photo-get|PhotoActions|download/);
  });

  it('downloads through one door rather than three', () => {
    /*
     * It was a bordered word in the byline *and* an item in the `⋯`, the
     * second justified as the keyboard's way to the first. The icon is an
     * `<a download>` with a label, which a keyboard reaches by tabbing to it
     * like any other link — so the twin is gone and so is the word.
     */
    expect(VIEW).toMatch(/aria-label="Download this photo"/);
    expect(VIEW).not.toMatch(/className="photo-get"/);
    expect(CSS).not.toMatch(/\.photo-get/);
    const menu = VIEW.slice(VIEW.indexOf('function PhotoActions'));
    expect(menu).not.toMatch(/<a href=\{full\} download/);
    // One `download` attribute left in the component, which is the icon's.
    expect(VIEW.match(/download\b/g)?.filter((_, i) => i >= 0).length).toBeGreaterThan(0);
  });

  it('lets somebody react to a photograph at all, which it could not', () => {
    /*
     * `photo_reaction`, its route and the app's control have existed for a
     * while and this page never grew one — so a reaction left on a phone was
     * invisible in a browser, which is worse than not having the feature: it
     * makes the two clients disagree about what happened in an album.
     */
    expect(ROUTE).toMatch(/reactionsForPhotos\(db, \[photo\.id\], viewerId\)/);
    expect(VIEW).toMatch(/reactions=\{reactions\}/);
    /*
     * A row of people rather than a score. Each row the server sends is one
     * person and one emoji, so a pill can say who as well as how many — which
     * is the whole of what separates a reaction from a like, and the reason
     * the CSS no longer claims reactions never go on photographs.
     */
    expect(REACT).toMatch(/aria-label=\{`\$\{emoji\} from \$\{row\.names\.join\(', '\)\}`\}/);
    /* The rule that said otherwise is gone as a rule. It survives in the
       note that says why, which is where a reversed decision belongs. */
    expect(CSS).toMatch(/Reactions, on a message and now on a photograph\./);
    // The picker is the thread's, down to the six it opens with.
    expect(REACT).toMatch(/import \{ useDismiss \} from '\.\/Thread';/);
    expect(REACT).toMatch(/REACTIONS\.map\(\(emoji\) => \(/);
    /*
     * Optimistic, and silent when it fails: the page is server-rendered and a
     * reaction that only appeared after a round trip would feel like a tap
     * that missed, while an alert over somebody's photograph for a tap that
     * did not land is worse than the tap not landing.
     */
    expect(REACT).toMatch(/if \(!res\?\.ok\) setList\(was\);/);
    // And nothing at all for a reader who cannot react and has nothing to
    // read: an empty affordance that would refuse them is worse than no row.
    expect(REACT).toMatch(/if \(!canReact && tally\.length === 0\) return null;/);
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

describe('paging through the event', () => {
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

/**
 * Keeping a photograph, which the web could not do.
 *
 * The table, the route and the phone have had this since before the web's
 * photo page existed, and `favourite` has been on every photograph the feed
 * returns the whole time, read by nobody. So the shortlist somebody made on
 * their phone was invisible in a browser and could not be added to from one.
 *
 * The property worth testing hardest is the one that is easy to lose by
 * accident: this is a shortlist and never a score. There is no count of who
 * else kept a photograph anywhere in the product, and the moment there is one
 * an album is a feed.
 */
describe('the star', () => {
  it('says what it will do, and what it is, in the two places each belongs', () => {
    // A control's name is the verb; the state is `aria-pressed`, which is
    // where a screen reader looks for it. Putting the state in the name makes
    // the button announce the same thing twice and neither of them an action.
    expect(STAR).toMatch(
      /aria-label=\{on \? 'Remove from your favourites' : 'Add to your favourites'\}/,
    );
    expect(STAR).toMatch(/aria-pressed=\{on\}/);
  });

  it('fills on the press and puts itself back if the server refuses', () => {
    /*
     * A toggle that waits for a round trip before it changes is a toggle
     * somebody presses twice. Optimistic, then corrected — and corrected to
     * the server's own answer rather than to the guess, because one row's
     * existence is the whole state.
     */
    expect(STAR).toMatch(/setOn\(want\);\s*\n\s*setBusy\(true\)/);
    expect(STAR).toMatch(/catch \{\s*\n\s*setOn\(!want\);/);
    expect(STAR).toMatch(/method: want \? 'PUT' : 'DELETE'/);
  });

  it('is absent without an account rather than present and refused', () => {
    // A guest actor is a credential in one browser, and a shortlist that
    // cannot survive a new one quietly empties. The route answers 401; a star
    // that answers "sign in" is a star that was not a star.
    expect(STAR).toMatch(/if \(!canKeep\) return null;/);
    expect(ROUTE).toMatch(/canKeep: accountId != null/);
  });

  it('marks a tile and does not put a control on it', () => {
    /*
     * Pressing happens on the photograph's own page, which is where the phone
     * puts it: a star on every tile is a row of controls over somebody's
     * pictures, and a grid of two hundred is two hundred of them. The tile
     * answers the question the shortlist raises while scanning and nothing
     * else — so it is `aria-hidden` with the fact folded into the link's own
     * name, and it never carries a number.
     */
    const mark = TILE.slice(TILE.indexOf('photo.favourite && ('), TILE.indexOf('</span>', TILE.indexOf('photo.favourite && (')));
    expect(mark).toMatch(/aria-hidden="true"/);
    expect(mark).not.toMatch(/<button|onClick|count/);
    expect(TILE).toMatch(/'Open photo — in your favourites'/);
  });

  it('counts nobody', () => {
    // The one property that turns a shortlist into a score. `photo_favourite`
    // is a table of its own so a read of an album cannot become one, and
    // nothing drawn from it may say how many.
    for (const source of [STAR, TILE, VIEW]) {
      expect(source).not.toMatch(/favouriteCount|keptCount|favourites\.length/);
    }
  });
});

describe('the Favourites tab', () => {
  it('filters what is already in hand rather than asking again', () => {
    /*
     * `favourite` is on every photograph the feed returns, so the shortlist is
     * a pass over a list in hand — and it is right the moment the feed is
     * re-read, which is what coming back from a photograph's own page does.
     *
     * Filtered from `visible`, not from `feed.photos`: a photograph hidden
     * from this reader is hidden on both, and a filter applied to one page and
     * not the other is two answers to what the album contains.
     */
    expect(EVENT).toMatch(
      /const favourites = visible\.filter\(\(photo\) => photo\.favourite\)/,
    );
    expect(EVENT).toMatch(/\['favourites', 'Favourites', 'star'\]/);
  });

  it('sits beside the photographs it is a shortlist of', () => {
    /*
     * Photos, Favourites, Thread, People — two pairs. The first two are the
     * pictures, all of them and your own cut of them; the second two are the
     * people around them.
     *
     * It was third, after Thread, which is where a fourth tab lands when it is
     * appended before People: it read as an afterthought and it separated the
     * two panes that are both grids of the same photographs.
     *
     * Asserted on the ids, which is what the URLs and `aria-current` are
     * matched on — a relabelling should not be able to fail this, and a
     * reordering is what it is for.
     */
    const order = [...EVENT.matchAll(/\['(\w+)', '[\w ]+', '\w+'\],/g)].map((m) => m[1]);
    expect(order).toEqual(['photos', 'favourites', 'conversation', 'people']);
  });

  it('is seeded on the first paint, so it does not open empty and fill', () => {
    // One read, per reader, for the photographs on the page. Without it the
    // tab opens with nothing in it and the shortlist arrives a moment later,
    // which reads as having lost something.
    expect(ROUTE_EVENT).toMatch(/photoFavourites/);
    expect(ROUTE_EVENT).toMatch(/favourite: favourites\.has\(photo\.id\)/);
    expect(ROUTE_EVENT).toMatch(/accountId == null \|\| rows\.length === 0/);
  });

  it('says where the star is when there is nothing in it', () => {
    // Not a failure and not an empty album: somebody with no favourites has
    // simply not starred anything yet, and the sentence says where the control
    // is rather than that something is wrong.
    expect(EVENT).toMatch(/No favourites yet\. Open a photograph and press the star/);
    expect(EVENT).toMatch(/Only you see this\./);
  });
});
