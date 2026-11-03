/**
 * Somebody in a public roll they do not run may ask people into it — the app's
 * "Invite people" on the People pane. Read from the route, as the other tests
 * of it are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROUTE = readFileSync(
  fileURLToPath(new URL('../app/api/events/[id]/invites/route.ts', import.meta.url)),
  'utf8',
);
// Shared with tagging, which asks people in on the same terms — see `@/invites`.
const INVITES = readFileSync(fileURLToPath(new URL('../src/invites.ts', import.meta.url)), 'utf8');
const ask = INVITES.slice(INVITES.indexOf('export async function mayAskIn'), INVITES.indexOf('export async function askIntoEvent'));

describe('inviting from a public roll', () => {
  it('lets in whoever runs it, or somebody in it', () => {
    expect(ROUTE).toContain('(!administers && !(await mayAskIn(db, event, actorId)))');
  });

  it('only on a public roll outside any group', () => {
    expect(ask).toContain("event.accessPolicy !== 'public' || event.groupId || event.deletedAt");
    expect(ask).toContain('eq(schema.eventParticipants.actorId, actorId)');
  });

  it('never lets somebody who does not run it promise the camera', () => {
    expect(ROUTE).toContain('const hostAsked = administers ? strings(body.hostActorIds) : [];');
  });
});
