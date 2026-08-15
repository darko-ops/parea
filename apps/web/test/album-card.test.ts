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
    // like an album, not like one with a field missing.
    expect(CARD).toMatch(/\{event\.place && \(/);
    expect(CARD).toMatch(/className="card-place"/);
  });
});

describe('the circles, and the number that takes over from them', () => {
  it('draws members rather than contributors', () => {
    /*
     * An album is the people in it. Drawing contributors meant somebody who
     * had been let in but not yet added a photograph was invisible on the card
     * — and they are exactly who it is trying to prompt.
     */
    expect(CARD).toMatch(/<Lenses count=\{event\.memberCount\}/);
    expect(CARD).not.toMatch(/<Lenses count=\{event\.contributorCount\}/);
  });

  it('caps the circles and says the rest as a number', () => {
    expect(CARD).toMatch(/const LENS_CAP = 3/);
    expect(CARD).toMatch(/event\.memberCount > LENS_CAP/);
    expect(CARD).toMatch(/\+\{event\.memberCount - LENS_CAP\} more/);
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
