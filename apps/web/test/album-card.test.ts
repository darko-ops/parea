/**
 * What an album card has to say.
 *
 * A card is the whole product on a wall — most people will see far more of
 * these than album pages — and every line on it was argued about separately.
 * This pins the arguments that are easy to undo by accident: which count the
 * circles stand for, when the number beside them appears, and that the two
 * derived facts are derived rather than written out again in a component.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ago } from '@parea/cards';
import { stripComments } from './support/source';

const read = (path: string) =>
  stripComments(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const CARD = read('../app/components/EventCard.tsx');
const CARDS = read('../src/cards.ts');
const EVENTS = read('../src/events.ts');
const API = read('../app/api/events/route.ts');
const CSS = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

describe('what a card says now that the photograph is the card', () => {
  it('says the name, and nothing else in that line', () => {
    expect(CARD).toMatch(/className="card-name">\{event\.name\}/);
  });

  it('says who and when, in that order', () => {
    /*
     * "8 people · Fri 14 Mar". The people first because that is what somebody
     * recognises an evening by, and the date is the album's own evening rather
     * than the last upload — except while it is being added to, where the
     * recent thing *is* the news.
     */
    expect(CARD).toMatch(/event\.memberCount === 1 \? 'person' : 'people'/);
    expect(CARD).toMatch(/event\.live \? `added to \$\{event\.added\}` : event\.date/);
  });

  it('says whose album it is, in both of their names', () => {
    /*
     * The name is what somebody recognises and the handle is what is unique,
     * so a card that printed one of them made the reader guess which. On your
     * own albums the name is "You" — your own name read back at you on a wall
     * of your own evenings is the page describing you to yourself.
     */
    expect(CARD).toMatch(/event\.mine \? 'You' : event\.creatorName/);
    expect(CARD).toMatch(/@\{event\.creatorHandle\}/);
  });

  it('has dropped the caption and the place', () => {
    /*
     * The two that made a wall of evenings look like a wall of listings — a
     * second sentence under the name, and a location tag. The place is still
     * searchable, because typing "greece" is what replaced the By place list,
     * but it is matched from the listing rather than carried into the card, so
     * the component holds nothing it does not draw.
     */
    expect(CARD).not.toMatch(/card-said/);
    // Not below the cover, which is the card this test is about. The album
    // with no photographs keeps its caption: that card is text, and the
    // sentence is most of what it has.
    const photoCard = CARD.slice(CARD.indexOf('card-cover'));
    expect(photoCard).not.toMatch(/event\.caption/);
    expect(CARD.slice(0, CARD.indexOf('card-cover'))).toMatch(/event\.caption/);
    expect(CARDS).not.toMatch(/place|memberAvatars/);
  });

  it('keeps the photograph count where a screen reader can still get it', () => {
    // On screen it was a number competing with the photographs it counted.
    expect(CARD).toMatch(/aria-label=\{label\}/);
    expect(CARD).toMatch(/\$\{event\.photoCount\}/);
  });
});

describe('the people on a card', () => {
  it('draws the faces, host first, and counts the rest', () => {
    // Three faces and a chip. The chip counts everybody the faces do not
    // show — `memberCount` minus what is drawn — not the difference between
    // two limits.
    expect(CARD).toMatch(/event\.faces\.map/);
    expect(CARD).toMatch(/event\.moreFaces > 0/);
    expect(CARDS).toMatch(/moreFaces: Math\.max\(0, listing\.memberCount - CARD_FACES\)/);
    expect(EVENTS).toMatch(/order by \(a\.id = \$\{schema\.events\.createdBy\}\) desc/);
  });

  it('puts a letter in an empty circle rather than a silhouette', () => {
    // A generic avatar is a photograph of nobody. The letter at least belongs
    // to the person whose circle it is.
    expect(CARD).toMatch(/fallback=\{[\s\S]{0,80}initial\(face\.name\)/);
  });

  it('fetches them with the listing rather than a query per card', () => {
    // This is the screen with the most rows on it; a round trip per album is a
    // page that gets slower the more somebody uses the product.
    expect(EVENTS).toMatch(/faces: sql<FaceRow\[\]>/);
    expect(EVENTS).toMatch(/limit \$\{CARD_FACES \+ 1\}/);
  });
});

describe('the relative time is derived once, on the server', () => {
  it('is built where the card data is built, not in the component', () => {
    /*
     * It is a relative time, so the server and the browser round it against
     * different clocks — and React discards the entire tree when the two
     * disagree. Building it in `toCards` means one clock decides.
     */
    expect(CARDS).toMatch(/added: ago\(/);
    expect(CARD).not.toMatch(/\bago\(|new Date\(/);
  });

  it('reads the way the card claims it does', () => {
    // The card's line is "added " plus this, so the shared function has to
    // return the tail of that sentence and not a whole one.
    const now = new Date('2026-08-15T12:00:00Z');
    expect(ago(new Date('2026-08-14T12:00:00Z'), now)).toBe('1 day ago');
    expect(ago(new Date('2026-08-15T11:40:00Z'), now)).toBe('20m ago');
  });
});

describe('the pictures cross the boundary as URLs, never as keys', () => {
  /*
   * The same rule the photo keys have: a storage key is an internal address,
   * and the bucket is private, so what a client can use is a presigned URL —
   * short-lived on purpose, because it is a capability.
   */
  it('presigns on the page path', () => {
    // The host's picture is the first circle in the faces row now, signed with
    // the rest of them rather than on its own.
    expect(CARDS).toMatch(/avatar: await avatarUrl\(face\.avatarKey\)/);
  });

  it('presigns on the API path, and rebuilds rather than spreads', () => {
    /*
     * Spreading the listing would ship a storage key the moment anybody adds a
     * field, which is the failure this shape exists to prevent — and it nearly
     * happened the first time somebody did: `coverKey` went onto the listing
     * for the cards to read, and `...rest` would have published it.
     */
    expect(API).toMatch(/const \{ creator, coverKey, faces: faceRows, \.\.\.rest \} = listing/);
    expect(API).toMatch(/avatarUrl: await avatarUrl\(creator\.avatarKey\)/);
    expect(API).not.toMatch(/avatarKey,/);
    expect(API).not.toMatch(/coverKey:/);
    // The faces leave as URLs too, by the same rule.
    expect(API).toMatch(/avatarUrl: await avatarUrl\(face\.avatarKey\)/);
    expect(API).not.toMatch(/avatarKey,/);
  });

  it('sends the cover as a URL, at the front of the mosaic', () => {
    // Both clients draw an album by its mosaic, so the cover leads by being
    // first in it rather than by a second field each of them has to learn.
    expect(API).toMatch(/const cover = await coverSrc\(listing\.coverKey\)/);
    expect(API).toMatch(/mosaic: \[\.\.\.\(cover \? \[cover\] : \[\]\), \.\.\.mosaic\]/);
  });

  it('answers whether a cover is set, on the album feed', () => {
    /*
     * A different question from the one the mosaic answers.
     *
     * Leading the mosaic with the cover is enough to *draw* an album, which is
     * all a card does — but from the mosaic alone the first entry is
     * indistinguishable from the newest upload, so a client cannot tell whether
     * a cover exists. Whoever runs the album needs to know, because the screen
     * that offers to change one should show the one there is and should not
     * offer to remove a cover that was never set.
     *
     * Presigned, by the same rule as everywhere else: the key never leaves.
     */
    const FEED = read('../app/api/events/[id]/photos/route.ts');
    expect(FEED).toMatch(/coverUrl: await coverSrc\(event\.coverKey\)/);
    expect(FEED).not.toMatch(/coverKey: /);
  });
});

describe('the size a cover is drawn at', () => {
  it('asks for the derivative that fits the card, not the one that fitted the old one', () => {
    /*
     * The card used to be four tiles about 145px wide, and `thumb` — 320px on
     * its longest edge — was two device pixels per CSS pixel and sharp. One
     * cover 320px tall and up to 360 wide is upwards of 720 device pixels on a
     * retina screen, and the same file stretched over that is the blur this
     * fixes. `grid` is 1280px and the deriver already makes it for every
     * photograph, so nothing has to be re-derived.
     */
    expect(CARDS).toMatch(/imageSrc\(first, 'grid', listing\.capEpoch\)/);
    expect(CARDS).toMatch(/imageSources\(first, 'grid', listing\.capEpoch\)/);
    expect(CARDS).not.toMatch(/'thumb'/);
  });

  it('lets the browser choose the encoding', () => {
    // At 1280px the AVIF is most of what keeps a bigger picture from being a
    // bigger download — and only the browser knows what it can decode.
    const COVER = read('../app/components/CoverImage.tsx');
    expect(COVER).toMatch(/<source key=\{source\.type\} srcSet=\{source\.src\} type=\{source\.type\}/);
    expect(COVER).toMatch(/source\.type !== 'image\/jpeg'/);
    // The JPEG is not optional: a <picture> whose sources are all rejected
    // renders nothing at all.
    expect(COVER).toMatch(/<img ref=\{ref\} src=\{src\}/);
  });

  it('sends the same picture to the profile, which builds its cards in the browser', () => {
    expect(API).toMatch(/imageSrc\(first, 'grid', listing\.capEpoch\)/);
  });
});

describe('the picture an album leads with', () => {
  it('is the cover when there is one, and the newest photo otherwise', () => {
    // One rule, in one place: search rows, the albums two people share, and
    // the card all ask the same function which image an album is.
    expect(CARDS).toMatch(/export async function leadImage/);
    expect(CARDS).toMatch(/const cover = await coverSrc\(listing\.coverKey\)/);
    expect(CARDS).toMatch(/if \(cover\) return cover/);
  });

  it('leaves the empty card to the album with no photographs', () => {
    /*
     * The mosaic and the photograph count stopped being the same number when
     * covers arrived: an album with a cover and nothing in it has a tile to
     * draw. Drawing it would replace the one card in the product whose job is
     * to get the first photograph out of somebody.
     */
    expect(CARD).toMatch(/if \(event\.photoCount === 0\)/);
    expect(CARD).not.toMatch(/if \(photos\.length === 0\)/);
  });

  it('never lets the key itself out of the server', () => {
    expect(EVENTS).toMatch(/coverKey: schema\.events\.coverKey/);
    expect(CARDS).toMatch(/presignGet\(key, 3600\)/);
  });
});
describe('changing the cover afterwards', () => {
  const MANAGE = read('../app/components/ManageView.tsx');
  const MANAGE_PAGE = read('../app/event/[id]/manage/page.tsx');

  it('sets and clears through the one endpoint that owns covers', () => {
    // The same route the create screen posts to. A second way to write a
    // cover would be a second place for "who may change this album's face" to
    // be decided, and that decision is `administer`.
    expect(MANAGE).toMatch(/fetch\(`\/api\/events\/\$\{eventId\}\/cover`, \{\s*method: 'POST'/);
    expect(MANAGE).toMatch(/fetch\(`\/api\/events\/\$\{eventId\}\/cover`, \{ method: 'DELETE' \}\)/);
  });

  it('scales the picture the same way the create screen does', () => {
    // One helper, imported by both. Two copies would drift, and the drift
    // would be a cover that came out different depending on which screen set
    // it — a difference nobody could see and nobody could explain.
    expect(MANAGE).toMatch(/import \{ coverBytes \} from '\.\/coverBytes'/);
    expect(read('../app/page.tsx')).toMatch(
      /import \{ coverBytes \} from '\.\/components\/coverBytes'/,
    );
  });

  it('is handed a URL and never the key', () => {
    expect(MANAGE_PAGE).toMatch(/coverUrl: await coverSrc\(event\.coverKey\)/);
    expect(MANAGE_PAGE).not.toMatch(/coverKey:/);
  });

  it('draws an expired cover as an empty frame, not as no cover', () => {
    /*
     * These URLs are presigned for an hour, so a manage screen left open over
     * lunch has one that no longer resolves. Falling back to the "add one"
     * plus would tell somebody their album has no cover when it has one.
     */
    expect(MANAGE).toMatch(/function CoverPreview/);
    expect(MANAGE).toMatch(/if \(failed\) return <span className="cover-preview cover-none"/);
  });
});

