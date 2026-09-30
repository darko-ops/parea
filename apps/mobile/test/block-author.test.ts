/**
 * Blocking from what somebody said, or from their page.
 *
 * A block used to be made only on a photograph or a moment. Now a held
 * message in either room, a comment under a photograph or a moment, and a
 * person's `⋯` all offer it — each naming what it was on, all asking the same
 * question through `block.ts`, and each clearing the screen after.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const API = read('src/api.ts');
const BLOCK = read('src/block.ts');
const THREAD = read('src/Thread.tsx');
const APP = read('App.tsx');
const GROUP = read('src/GroupThread.tsx');
const VIEWER = read('src/PhotoViewer.tsx');
const PERSON = read('src/Person.tsx');

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  if (end < 0) throw new Error(`anchor not found: ${to}`);
  return source.slice(start, end);
};

describe('the call', () => {
  it('posts exactly the one target it is given', () => {
    const call = between(API, '  blockAuthor(', '\n  }\n');
    expect(call).toMatch(/\{ messageId: string \}/);
    expect(call).toMatch(/\{ groupMessageId: string \}/);
    expect(call).toMatch(/\{ momentCommentId: string \}/);
    expect(call).toMatch(/\{ actorId: string \}/);
    expect(call).toMatch(/this\.call\('\/api\/blocks'/);
    expect(call).toMatch(/method: 'POST'/);
    expect(call).toMatch(/body: JSON\.stringify\(target\)/);
  });
});

describe('the question', () => {
  it('asks first, says what it costs and where the undo is', () => {
    expect(BLOCK).toMatch(/Even in groups you share|even in groups you share/);
    expect(BLOCK).toMatch(/They won't be told\./);
    expect(BLOCK).toMatch(/Settings → Blocked/);
    expect(BLOCK).toMatch(/text: 'Cancel', style: 'cancel'/);
    expect(BLOCK).toMatch(/text: 'Block',\s*style: 'destructive'/);
    // Only the destructive press calls; Cancel resolves false.
    expect(BLOCK).toMatch(/api\.blockAuthor\(target\)/);
    expect(BLOCK).toMatch(/onPress: \(\) => resolve\(false\)/);
  });

  it('says so after, and a short word when it fails', () => {
    expect(BLOCK).toMatch(/Alert\.alert\('Blocked'/);
    expect(BLOCK).toMatch(/'That did not work', 'Try again in a moment\.'/);
  });
});

describe('where it is offered', () => {
  it('sits under Report in a held message, never on your own', () => {
    expect(THREAD).toMatch(/block\?: \(messageId: string\) => Promise<boolean>;/);
    expect(THREAD).toMatch(/actions\.block && !item\.author\.mine/);
    expect(THREAD).toMatch(/actions\.block!\(item\.id\)\.then\(\(done\) => \(done \? onChanged\(\) : undefined\)\)/);
    expect(THREAD).toMatch(/const block = !mine \? onBlock : undefined;/);
    expect(THREAD).toMatch(/report != null \|\| block != null/);
    const sheet = between(THREAD, '{onReport && (', '</Modal>');
    expect(sheet).toMatch(/\{onBlock && \(/);
    expect(sheet).toMatch(/>Block<\/Text>/);
  });

  it('names an album line by message and a group line by group message', () => {
    expect(APP).toMatch(/block: \(id: string\) => blockAuthor\(api, \{ messageId: id \}\)/);
    expect(GROUP).toMatch(/block: \(id: string\) => blockAuthor\(api, \{ groupMessageId: id \}\)/);
  });

  it('names a comment under a photograph by what it is, and reloads', () => {
    expect(VIEWER).toMatch(
      /moment \? \{ momentCommentId: message\.id \} : \{ messageId: message\.id \}/,
    );
    expect(between(VIEWER, 'onBlock={() =>', 'about={null}')).toMatch(/done \? onChanged\(\)/);
  });

  it('offers it on somebody else’s page and goes back after', () => {
    const corner = between(PERSON, "standing !== 'self' && (", '</RoundButton>');
    expect(corner).toMatch(/text: 'Report'/);
    expect(corner).toMatch(/text: 'Block'/);
    expect(corner).toMatch(/blockAuthor\(api, \{ actorId: person\.actorId \}\)/);
    expect(corner).toMatch(/done && onBack\(\)/);
  });
});
