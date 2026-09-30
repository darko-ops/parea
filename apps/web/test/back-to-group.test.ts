/**
 * Opening a roll from a group's page and pressing back returns to the group.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

describe('a roll opened from a group', () => {
  it('is linked with the group it came from', () => {
    expect(read('app/components/GroupView.tsx')).toContain('href={`/event/${event.id}?group=${group.id}`}');
  });

  it('points its back arrow at that group, and only at a real id', () => {
    const page = read('app/event/[id]/page.tsx');
    expect(page).toMatch(/backHref=\{backHrefFor\(\(await searchParams\)\.group\)\}/);
    expect(page).toMatch(/UUID\.test\(group\) \? `\/group\/\$\{group\}` : '\/events'/);
    expect(read('app/components/EventView.tsx')).toMatch(/href=\{backHref\}/);
  });

  it('keeps the way back when switching tabs', () => {
    const view = read('app/components/EventView.tsx');
    expect(view).toMatch(/href=\{tabHref\(eventId, id, backHref\)\}/);
    expect(view).toMatch(/params\.set\('group', group\)/);
  });
});
