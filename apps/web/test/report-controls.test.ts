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

/*
 * And the person behind a message, a comment or a profile can be blocked from
 * the same place it can be reported, through one helper, each surface telling
 * `/api/blocks` which thing it was looking at by the key the route reads.
 */
const BLOCKS: [string, string[]][] = [
  ['Thread.tsx', ['{ messageId: id }', '{ groupMessageId: id }']],
  ['MomentComments.tsx', ['blockPerson({ momentCommentId: comment.id })']],
  ['PersonView.tsx', ['blockPerson({ actorId: person.actorId })']],
];

describe('block controls', () => {
  it.each(BLOCKS)('%s blocks through the shared helper', (file, needles) => {
    const source = read(file);
    expect(source).toMatch(/import \{[^}]*\bblockPerson\b[^}]*\} from '\.\/report'/);
    expect(source).toContain('blockAsk(');
    for (const needle of needles) expect(source).toContain(needle);
  });

  it('the thread picks the key by the room it is in', () => {
    expect(read('Thread.tsx')).toMatch(
      /room\.kind === 'group' \? \{ groupMessageId: id \} : \{ messageId: id \}/,
    );
  });

  it('the helper posts to the one route, and nothing else does', () => {
    expect(read('report.ts')).toContain("fetch('/api/blocks'");
    for (const [file] of BLOCKS) expect(read(file)).not.toContain("'/api/blocks'");
  });

  it('asks before it blocks, in words that say it is both ways and undoable', () => {
    const source = read('report.ts');
    expect(source).toContain("You won't see each other's messages, photos, comments or albums");
    expect(source).toContain('You can undo this in Settings');
  });
});
