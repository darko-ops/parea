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

describe('the four things a card says', () => {
  it('says the name and the caption the host wrote', () => {
    expect(CARD).toMatch(/className="card-name">\{event\.name\}/);
    expect(CARD).toMatch(/event\.caption && <div className="card-caption">/);
  });

  it('says when it was last added to', () => {
    expect(CARD).toMatch(/className="card-when">\{event\.added\}/);
  });

  it('does not say where, and does not draw the members', () => {
    /*
     * Both were on the photographs and both came off. The place is still
     * searchable — typing "greece" is what replaced the By place list — but it
     * is matched from the listing rather than carried into the card, so the
     * component holds nothing it does not draw.
     */
    expect(CARD).not.toMatch(/card-tag|card-faces|<Faces\b/);
    expect(CARDS).not.toMatch(/place|memberAvatars/);
  });

  it('says the time without saying "added"', () => {
    // On a card whose other line is a name and a handle, the only time
    // anything can be talking about is the last time something arrived.
    expect(CARDS).toMatch(/added: ago\(/);
    expect(CARDS).not.toMatch(/`added \$\{/);
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

describe('whose album it is', () => {
  it('draws their picture beside the name and their handle beside the caption', () => {
    expect(CARD).toMatch(/src=\{event\.creatorAvatar\}/);
    expect(CARD).toMatch(/@\{event\.creatorHandle\}/);
  });

  it('puts a letter in the circle rather than a silhouette', () => {
    // A generic avatar is a photograph of nobody. The letter at least belongs
    // to the person whose album it is.
    expect(CARD).toMatch(/initial\(event\.creatorHandle, event\.name\)/);
  });

  it('still draws a card for an album whose host has no handle or picture', () => {
    // An account is optional in this product, and so is a picture. Both of
    // these are null far more often than not.
    expect(CARD).toMatch(/\(event\.creatorHandle \|\| event\.caption\) && \(/);
    expect(CARD).toMatch(/handle\?\.trim\(\) \|\| name\.trim\(\) \|\| '\?'/);
  });
});

describe('the pictures cross the boundary as URLs, never as keys', () => {
  /*
   * The same rule the photo keys have: a storage key is an internal address,
   * and the bucket is private, so what a client can use is a presigned URL —
   * short-lived on purpose, because it is a capability.
   */
  it('presigns on the page path', () => {
    expect(CARDS).toMatch(/creatorAvatar: await avatarUrl\(listing\.creator\.avatarKey\)/);
  });

  it('presigns on the API path, and rebuilds rather than spreads', () => {
    /*
     * Spreading the listing would ship a storage key the moment anybody adds a
     * field, which is the failure this shape exists to prevent — and it nearly
     * happened the first time somebody did: `coverKey` went onto the listing
     * for the cards to read, and `...rest` would have published it.
     */
    expect(API).toMatch(/const \{ creator, coverKey, \.\.\.rest \} = listing/);
    expect(API).toMatch(/avatarUrl: await avatarUrl\(creator\.avatarKey\)/);
    expect(API).not.toMatch(/avatarKey,/);
    expect(API).not.toMatch(/coverKey:/);
  });

  it('sends the cover as a URL, at the front of the mosaic', () => {
    // Both clients draw an album by its mosaic, so the cover leads by being
    // first in it rather than by a second field each of them has to learn.
    expect(API).toMatch(/const cover = await coverSrc\(listing\.coverKey\)/);
    expect(API).toMatch(/mosaic: \[\.\.\.\(cover \? \[cover\] : \[\]\), \.\.\.mosaic\]/);
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
