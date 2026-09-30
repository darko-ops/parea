/**
 * Every kind of thing `/api/reports` takes has a way to be reported from.
 *
 * The route landed with six target kinds and no button for any of them, and a
 * route nobody can reach is a report nobody can make. Which component draws
 * which control is not something typechecking can see, so the wiring is read
 * off the source: each surface calls the one shared helper with its kind.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../app/components/${name}`, import.meta.url)), 'utf8');

const SURFACES: [string, string[]][] = [
  ['Thread.tsx', ["'event_message'", "'group_message'"]],
  ['MomentView.tsx', ["reportContent('moment'"]],
  ['MomentComments.tsx', ["reportContent('moment_comment'"]],
  ['PersonView.tsx', ["reportContent('profile'"]],
  ['GroupView.tsx', ["reportContent('group'"]],
];

describe('report controls', () => {
  it.each(SURFACES)('%s reports through the shared helper', (file, needles) => {
    const source = read(file);
    expect(source).toContain("from './report'");
    for (const needle of needles) expect(source).toContain(needle);
  });

  it('the thread reports only what somebody else wrote', () => {
    expect(read('Thread.tsx')).toMatch(/!message\.author\.mine && \(\s*<OthersMenu/);
  });

  it('the helper posts to the one route', () => {
    expect(read('report.ts')).toContain("fetch('/api/reports'");
  });
});
