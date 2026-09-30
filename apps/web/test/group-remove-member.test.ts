/**
 * An admin can take somebody out of a group from the group page.
 *
 * `DELETE /api/groups/{id}/members?actorId=` shipped before anything called it,
 * and which component draws which control — and for whom — is not something
 * typechecking can see. So the wiring is read off the source, as the report
 * controls are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../app/components/GroupView.tsx', import.meta.url)),
  'utf8',
);

describe('removing a group member', () => {
  it('calls the members route with the actor named', () => {
    expect(source).toMatch(
      /fetch\(\s*`\/api\/groups\/\$\{group\.id\}\/members\?actorId=\$\{encodeURIComponent\(person\.actorId\)\}`,\s*\{ method: 'DELETE' \}/,
    );
  });

  it('is offered only to an admin', () => {
    expect(source).toMatch(/group\.role === 'admin' && removable\.length > 0 && \(\s*<Menu/);
    expect(source).toMatch(/removing && group\.role === 'admin' && \(/);
  });

  it('is offered only over members, which leaves out admins and yourself', () => {
    expect(source).toContain("group.people.filter((person) => person.role === 'member')");
  });

  it('asks on the page rather than in a dialog', () => {
    expect(source).not.toMatch(/\bconfirm\(/);
    expect(source).toContain('They can come back only if an admin invites them.');
  });
});
