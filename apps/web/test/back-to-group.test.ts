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
    expect(page).toMatch(
      /backHref=\{backHrefFor\(\s*\(await searchParams\)\.group,\s*\(await searchParams\)\.from,\s*\(await searchParams\)\.person,\s*\)\}/,
    );
    expect(page).toMatch(/if \(group && UUID\.test\(group\)\) return `\/group\/\$\{group\}`;/);
    expect(page).toMatch(/return from === 'profile' \? '\/account' : '\/events';/);
    // Somebody else's profile, only for a handle-shaped value.
    expect(page).toMatch(/if \(person && HANDLE\.test\(person\)\) return `\/u\/\$\{encodeURIComponent\(person\)\}`;/);
    expect(read('app/components/EventView.tsx')).toMatch(/params\.set\('person',/);
    expect(read('app/components/EventView.tsx')).toMatch(/href=\{backHref\}/);
  });

  it('opened from your profile, goes back there — and so does deleting it', () => {
    expect(read('app/components/AccountView.tsx')).toContain('href: `/event/${event.id}?from=profile`');
    const view = read('app/components/EventView.tsx');
    expect(view).toMatch(/params\.set\('from', 'profile'\)/);
    expect(view).toContain("/manage${backHref === '/account' ? '?from=profile' : ''}");
    expect(read('app/event/[id]/manage/page.tsx')).toContain(
      "fromProfile={(await searchParams).from === 'profile'}",
    );
    expect(read('app/components/ManageView.tsx')).toContain(
      "window.location.href = fromProfile ? '/account' : '/';",
    );
  });

  it('keeps the way back when switching tabs', () => {
    const view = read('app/components/EventView.tsx');
    expect(view).toMatch(/href=\{tabHref\(eventId, id, backHref\)\}/);
    expect(view).toMatch(/params\.set\('group', group\)/);
  });
});

describe("a roll in a group's people tab", () => {
  it('says the group decides who is in it, and links there', () => {
    const view = read('app/components/EventView.tsx');
    expect(view).toMatch(/\{group && \(\s*<p className="people-group-note">/);
    expect(view).toMatch(/To add or remove\s+people, do it in the group\./);
    expect(view).toMatch(/<a href=\{`\/group\/\$\{group\.id\}`\}>Open \{group\.name\}<\/a>/);
  });
});
