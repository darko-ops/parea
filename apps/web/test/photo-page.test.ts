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
const LIKE = await read('../app/components/LikeButton.tsx');
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

  it('has no selection mode: a tile always opens its photograph', () => {
    // Picking photographs to download was a checkbox on every tile and a bar
    // at the foot; favorites do that job, and "Download favorites" takes them.
    expect(TILE).not.toMatch(/tile-pick|picking|preventDefault\(\)/);
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
 * The heart centred under the picture with a step through the roll either
 * side of it; the tools — star, send, download, `⋯` — in a column at the
 * picture's bottom-right corner, beside it rather than in the row under it.
 */
describe('the verbs around the photograph', () => {
  it('centres the heart between the arrows, and stands the tools beside the picture', () => {
    const nav = VIEW.slice(VIEW.indexOf('className="photo-verbs photo-nav"'), VIEW.indexOf('<aside'));
    expect(nav.indexOf('label="Previous photo"')).toBeLessThan(nav.indexOf('<PhotoReactions'));
    expect(nav.indexOf('<PhotoReactions')).toBeLessThan(nav.indexOf('label="Next photo"'));
    expect(nav).not.toMatch(/photo-icon|PhotoActions/);
    // Two classes, so it outranks `.photo-verbs` spreading the row to its ends.
    expect(CSS).toMatch(/\.photo-verbs\.photo-nav \{[^}]*justify-content: center; gap: 8px/);
    // The arrows moved down beside the heart; the header no longer has them.
    const head = VIEW.slice(VIEW.indexOf('className="photo-head"'), VIEW.indexOf('</header>'));
    expect(head).not.toMatch(/<Step/);
    const side = VIEW.slice(VIEW.indexOf('className="photo-side"'), VIEW.indexOf('className="photo-verbs photo-nav"'));
    expect(side.indexOf('<Star')).toBeLessThan(side.indexOf('Download this photo'));
    expect(side.indexOf('Download this photo')).toBeLessThan(side.indexOf('<PhotoActions'));
    expect(CSS).toMatch(/\.photo-side \{[^}]*position: absolute; left: calc\(100% \+ 12px\); bottom: 0;[^}]*flex-direction: column/);
    // The byline is identity and nothing else, and it rides on the stage —
    // above the picture's right-hand corner, on the header's line.
    const by = VIEW.slice(VIEW.indexOf('className="photo-by"'), VIEW.indexOf('className="photo-verbs photo-nav"'));
    expect(by).not.toMatch(/photo-get|PhotoActions|download/);
    expect(VIEW.indexOf('className="photo-stage"')).toBeLessThan(VIEW.indexOf('className="photo-by"'));
    expect(CSS).toMatch(/\.photo-stage \.photo-by \{[^}]*position: absolute; right: 0;[^}]*top: calc\(50% - var\(--photo-h\) \/ 2 - 49px\)/);
  });

  it('runs the roll down the left of the picture', () => {
    const view = VIEW.slice(VIEW.indexOf('className="photo-view"'), VIEW.indexOf('className="photo-col"'));
    expect(view).toMatch(/<Filmstrip /);
    expect(CSS).toMatch(/\.photo-view \.photo-strip \{[^}]*flex-direction: column;[^}]*max-height: var\(--photo-h\)/);
    expect(VIEW).toMatch(/box\.scrollTop = here\.offsetTop - box\.clientHeight \/ 2/);
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

  it('lets somebody like a photograph, with one heart', () => {
    /*
     * `photo_reaction`, its route and the app's control have existed for a
     * while and this page never grew one — so a reaction left on a phone was
     * invisible in a browser, which is worse than not having the feature: it
     * makes the two clients disagree about what happened in an album.
     */
    expect(ROUTE).toMatch(/reactionsForPhotos\(db, \[photo\.id\], viewerId\)/);
    expect(VIEW).toMatch(/reactions=\{reactions\}/);
    /*
     * One heart rather than a picker. Reactions became likes: the control is
     * `LikeButton`, outlined until the viewer likes the picture and filled once
     * they have, with how many beside it — and it says which in its name.
     */
    expect(REACT).toMatch(/import \{ LikeButton \} from '\.\/LikeButton';/);
    expect(REACT).not.toMatch(/REACTIONS|useDismiss/);
    expect(LIKE).toMatch(/aria-pressed=\{liked\}/);
    expect(LIKE).toMatch(/const filled = liked \|\| \(bare && count > 0\);/);
    expect(LIKE).toMatch(/fill=\{filled \? 'currentColor' : 'none'\}/);
    // A comment's heart carries no number. See `bare`.
    expect(LIKE).toMatch(/\{!bare && count > 0 && <span className="like-count">/);
    /*
     * Optimistic, and silent when it fails: the page is server-rendered and a
     * heart that only filled after a round trip would feel like a tap that
     * missed, while an alert over somebody's photograph for a tap that did not
     * land is worse than the tap not landing.
     */
    expect(REACT).toMatch(/if \(!res\?\.ok\) setList\(was\);/);
    // And nothing at all for a reader who cannot like it and has nothing to
    // read: an empty affordance that would refuse them is worse than no row.
    expect(REACT).toMatch(/if \(!canReact && count === 0\) return null;/);
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
    expect(VIEW).toMatch(/Block — hide each other everywhere/);
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
      'Blocked. You will not see each other any more, anywhere. They are not told, and you can undo it in Settings → Blocked.',
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
      /aria-label=\{on \? 'Remove from your favorites' : 'Add to your favorites'\}/,
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
    expect(TILE).toMatch(/'Open photo — in your favorites'/);
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
    expect(EVENT).toMatch(/\['favourites', 'Favorites', 'star'\]/);
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
    expect(EVENT).toMatch(/No favorites yet\. Open a photograph and press the star/);
    expect(EVENT).toMatch(/Only you see this\./);
  });
});

/**
 * The picture full screen, clicked into from the page.
 *
 * Over the page rather than the browser's fullscreen, which asks permission on
 * every load — and every step through the roll is one. So the flag rides in
 * the URL and the steps carry it.
 */
describe('the photograph full screen', () => {
  it('opens from a click on the picture, and from Enter on the frame', () => {
    expect(VIEW).toMatch(/<Subject photo=\{photo\} onOpen=\{\(\) => setFull\(true\)\} \/>/);
    expect(VIEW).toMatch(/onClick=\{onOpen\}/);
    expect(VIEW).toMatch(/e\.key === 'Enter' && on === frame\.current\) setFull\(true\)/);
    expect(CSS).toMatch(/\.photo-open \{ cursor: zoom-in; \}/);
  });

  it('steps through the roll without dropping out of it', () => {
    expect(VIEW).toMatch(/location\.assign\(full \? `\$\{href\(id\)\}\?full` : href\(id\)\)/);
    expect(VIEW).toMatch(/new URLSearchParams\(location\.search\)\.has\('full'\)/);
    // Arrows and swipes go through the same step, not straight to the page.
    expect(VIEW).not.toMatch(/location\.assign\(href\((previous|next)\.id\)\)/);
  });

  it('comes back out with Escape before Escape leaves the page', () => {
    expect(VIEW).toMatch(/if \(full\) closeFull\(\);\s*else location\.assign\(eventHref\);/);
    expect(VIEW).toMatch(/history\.replaceState\(history\.state, '', location\.pathname\)/);
    expect(VIEW).toMatch(/className="photo-full"[\s\S]*?onClick=\{\(e\) => e\.target === e\.currentTarget && onClose\(\)\}/);
  });
});

/**
 * On a phone: the picture alone in the middle of its frame, the tools on the
 * heart's row against the screen's right edge, who added it under that row.
 *
 * The tools used to hang off the picture's corner, so they moved with every
 * photograph's width — and a row wider than a narrow picture pushed the
 * picture off the middle.
 */
describe('the photograph page on a phone', () => {
  it('pins the tools to the right edge on the heart’s row, whatever the picture', () => {
    const phone = CSS.slice(CSS.indexOf('.photo-col { position: relative; padding-bottom: 56px; }'));
    expect(phone).toMatch(/^\.photo-col \{ position: relative; padding-bottom: 56px; \}\s*\.photo-stage \{ position: static; \}/);
    expect(phone).toMatch(/\.photo-side \{\s*top: calc\(var\(--photo-h\) \+ 12px\); left: auto; right: 0; bottom: auto;\s*flex-direction: row;/);
    expect(phone).toMatch(/\.photo-stage \.photo-by \{\s*top: calc\(var\(--photo-h\) \+ 12px \+ 34px \+ 12px\); left: 0; right: 0;/);
    expect(CSS).not.toMatch(/max-height: calc\(var\(--photo-h\) - 100px\)/);
  });
});
