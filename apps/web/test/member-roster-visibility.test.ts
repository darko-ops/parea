/**
 * Who is shown the list of people in an album.
 *
 * Holding the link lets somebody see the photographs; it no longer lets them
 * see everybody who has ever opened them. The rule is one function, and the
 * three places that hand a roster to a browser each have to ask it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { mayListMembers, visibleMembers, type Member } from '@/members';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

describe('mayListMembers', () => {
  it('shows the roster to a signed-in participant', () => {
    expect(mayListMembers(true, 'actor-1')).toBe(true);
  });

  it('hides it from a guest holding the link', () => {
    expect(mayListMembers(true, null)).toBe(false);
  });

  it('hides it from an account that may only look', () => {
    expect(mayListMembers(false, 'actor-1')).toBe(false);
  });
});

describe('visibleMembers', () => {
  const host = { actorId: 'h', isCreator: true } as Member;
  const guest = { actorId: 'g', isCreator: false } as Member;

  it('is everybody for somebody allowed the list', () => {
    expect(visibleMembers([host, guest], true)).toEqual([host, guest]);
  });

  it('is the host alone otherwise, who is named on the album anyway', () => {
    expect(visibleMembers([host, guest], false)).toEqual([host]);
  });
});

describe('every page that hands out a roster', () => {
  it.each([
    'app/api/events/[id]/photos/route.ts',
    'app/event/[id]/page.tsx',
    'app/event/[id]/p/[photoId]/page.tsx',
  ])('%s asks first', (file) => {
    const source = read(file);
    expect(source).toContain('mayListMembers(');
    expect(source).toContain('visibleMembers(');
    // No bare `members: await membersOf(...)` or `members={await membersOf(...)}`.
    expect(source).not.toMatch(/members(:|=\{)\s*await membersOf/);
    expect(source).not.toMatch(/roster:\s*await rosterFor/);
  });
});
