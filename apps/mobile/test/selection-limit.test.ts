/**
 * Twenty photographs at a time, wherever somebody chooses them.
 *
 * Processing is one photo at a time, so a batch of two hundred takes long
 * enough to look like it failed. `MAX_PER_SELECTION` in `@parea/upload` is the
 * one number for it, shared with the web — read from there, never typed here.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const PICK = read('src/PickPhotos.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  if (end < 0) throw new Error(`anchor not found: ${to}`);
  return source.slice(start, end);
};

describe('the system picker', () => {
  const pick = code(between(APP, 'const pickFromLibrary = useCallback(', 'await enqueue(files)'));

  it('is told the limit, from the shared constant', () => {
    expect(APP).toMatch(/import \{[^}]*\bMAX_PER_SELECTION\b[^}]*\} from '@parea\/upload'/);
    expect(pick).toMatch(/allowsMultipleSelection: true/);
    expect(pick).toMatch(/selectionLimit: MAX_PER_SELECTION/);
  });

  it('keeps to it even when the picker does not', () => {
    expect(pick).toMatch(/picked\.assets\.slice\(0, MAX_PER_SELECTION\)/);
    expect(pick).not.toMatch(/of picked\.assets\.entries\(\)/);
  });

  it('is never a hard-coded twenty', () => {
    expect(pick).not.toMatch(/selectionLimit: \d/);
  });
});

describe('choosing for a new roll', () => {
  const pick = code(PICK);

  it('stops adding at the limit and says so', () => {
    expect(PICK).toMatch(/import \{ MAX_PER_SELECTION \} from '@parea\/upload'/);
    const toggle = between(pick, 'const toggle = useCallback(', '}, []);');
    expect(toggle).toMatch(/was\.length >= MAX_PER_SELECTION\) return was/);
    expect(pick).toMatch(/Up to \{MAX_PER_SELECTION\} at a time\. Add the rest after these are in\./);
  });
});
