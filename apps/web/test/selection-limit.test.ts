/**
 * Twenty photos a selection, on both pickers.
 *
 * `<input type="file" multiple>` cannot be told how many, so the limit is
 * applied after the pick. The helper is tested as a function; that both
 * pickers go through it, with the shared constant rather than a number of
 * their own, is read from the source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_PER_SELECTION } from '@parea/upload';
import { capSelection, selectionNote } from '../app/components/capSelection';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('capSelection', () => {
  it('keeps everything under the limit', () => {
    expect(capSelection(0, range(5), 20)).toEqual({ kept: range(5), dropped: 0 });
    expect(capSelection(0, range(20), 20)).toEqual({ kept: range(20), dropped: 0 });
  });

  it('keeps the first ones, in pick order, up to the limit', () => {
    expect(capSelection(0, range(25), 20)).toEqual({ kept: range(20), dropped: 5 });
  });

  it('counts what is already picked', () => {
    expect(capSelection(15, range(10), 20)).toEqual({ kept: range(5), dropped: 5 });
    expect(capSelection(20, range(3), 20)).toEqual({ kept: [], dropped: 3 });
    expect(capSelection(25, range(3), 20)).toEqual({ kept: [], dropped: 3 });
  });

  it('says how many were kept', () => {
    expect(selectionNote(20, 20)).toMatch(/kept the first 20/);
    expect(selectionNote(5, 20)).toMatch(/kept 5\./);
    expect(selectionNote(0, 20)).toMatch(/20 are already picked/);
  });
});

describe('both pickers apply it', () => {
  it.each([
    ['create', '../app/page.tsx'],
    ['event', '../app/components/EventView.tsx'],
  ])('%s page', (_, path) => {
    const src = read(path);
    expect(src).toMatch(/capSelection\([^)]*MAX_PER_SELECTION\)/);
    expect(src).toMatch(/import \{[^}]*MAX_PER_SELECTION[^}]*\} from '@parea\/upload'/);
  });

  it('the event page uploads only what was kept', () => {
    expect(read('../app/components/EventView.tsx')).toMatch(/uploads\.add\(kept\)/);
  });

  it('is twenty', () => {
    expect(MAX_PER_SELECTION).toBe(20);
  });
});
