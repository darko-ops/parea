/**
 * The people somebody has blocked are listed in settings, with a way back.
 *
 * `/api/blocks` grew a GET and an unblock-by-person for this list, and a
 * route nobody calls is a block nobody can undo. Which component calls it,
 * and where that component is drawn, is not something typechecking can see,
 * so the wiring is read off the source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../app/components/${name}`, import.meta.url)), 'utf8');

describe('blocked list', () => {
  const source = read('BlockedList.tsx');

  it('reads the list from the route', () => {
    expect(source).toContain("fetch('/api/blocks')");
  });

  it('unblocks by person', () => {
    expect(source).toMatch(/fetch\('\/api\/blocks', \{\s*method: 'DELETE'/);
    expect(source).toContain('JSON.stringify({ actorId: person.actorId })');
  });

  it('asks in the row rather than in a browser dialog', () => {
    expect(source).not.toContain('confirm(');
  });

  it('is drawn in settings', () => {
    const account = read('AccountView.tsx');
    expect(account).toContain("from './BlockedList'");
    expect(account).toContain('<BlockedList />');
  });
});
