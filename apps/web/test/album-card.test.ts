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

  it('says where, and only when there is a where', () => {
    // No empty slot for a place nobody typed — an album with none should look
    // like an album, not like one with a field missing. It is absolutely
    // positioned for the same reason: the card is the same height either way.
    expect(CARD).toMatch(/\{event\.place && \(/);
    expect(CARD).toMatch(/className="card-tag"/);
    expect(CSS).toMatch(/\.card-tag \{[^}]*position: absolute/s);
  });

  it('keeps the place legible over photographs it knows nothing about', () => {
    /*
     * Two hundred unknown colours behind a pill. Translucent-without-blur is
     * the case that becomes unreadable rather than merely less pretty, so the
     * solid fill is the default and the blur is the enhancement — not the
     * other way round.
     */
    const tag = CSS.slice(CSS.indexOf('.card-tag {'));
    expect(tag.slice(0, tag.indexOf('}'))).toMatch(/background: rgba\(255, 255, 255, \.92\)/);
    expect(CSS).toMatch(/@supports \(backdrop-filter: blur\(6px\)\)/);
  });
});

describe('the faces, and the number that takes over from them', () => {
  it('draws them on the photographs, opposite the place', () => {
    // Both facts about the evening sit on the evening; the strip below is the
    // album's own details.
    expect(CARD).toMatch(/className="card-faces"/);
    expect(CSS).toMatch(/\.card-faces \{[^}]*position: absolute[^}]*left: 10px/s);
  });

  it('draws the members, not the people who happened to upload', () => {
    /*
     * An album is the people in it. Drawing contributors meant somebody who
     * had been let in but not yet added a photograph was invisible on the card
     * — and they are exactly who it is trying to prompt.
     */
    expect(CARD).toMatch(/<Faces avatars=\{event\.memberAvatars\}/);
    expect(CARD).not.toMatch(/contributorCount/);
  });

  it('counts everybody but the creator, whose picture is beside the title', () => {
    // The same person twice on one card reads as two people.
    expect(CARD).toMatch(/const others = Math\.max\(0, event\.memberCount - 1\)/);
    expect(CARD).toMatch(/others > event\.memberAvatars\.length/);
    // "+2" rather than "+2 more" now that it sits on the photographs as a
    // pill of its own: a word inside a badge over a picture is furniture.
    expect(CARD).toMatch(/\+\{others - event\.memberAvatars\.length\}/);
  });

  it('is bounded in the query rather than in the component', () => {
    // The point of the cap is that an album with two hundred people costs the
    // same to list as one with three. A component-side slice would fetch all
    // two hundred first.
    expect(EVENTS).toMatch(/export const CARD_FACES = 3/);
    expect(EVENTS).toMatch(/limit \$\{CARD_FACES\}/);
  });

  it('never asks for the creator twice', () => {
    expect(EVENTS).toMatch(/ep\.actor_id <> \$\{schema\.events\.createdBy\}/);
  });

  it('does not shuffle the row as the number grows', () => {
    // "+1" and "+11" are different widths in a proportional face, and a grid
    // of cards that reflows between them looks broken while it is scrolled.
    expect(CSS).toMatch(/\.card-more \{[^}]*tabular-nums/s);
  });
});

describe('the relative time is derived once, on the server', () => {
  it('is built where the card data is built, not in the component', () => {
    /*
     * It is a relative time, so the server and the browser round it against
     * different clocks — and React discards the entire tree when the two
     * disagree. Building it in `toCards` means one clock decides.
     */
    expect(CARDS).toMatch(/added: `added \$\{ago\(/);
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
    expect(CARDS).toMatch(/listing\.members\.map\(\(member\) => avatarUrl\(member\.avatarKey\)\)/);
  });

  it('presigns on the API path, and rebuilds rather than spreads', () => {
    // Spreading the listing would ship `avatarKey` the moment anybody adds a
    // field, which is the failure this shape exists to prevent.
    expect(API).toMatch(/const \{ creator, members, \.\.\.rest \} = listing/);
    expect(API).toMatch(/avatarUrl: await avatarUrl\(creator\.avatarKey\)/);
    expect(API).not.toMatch(/avatarKey,/);
  });
});
