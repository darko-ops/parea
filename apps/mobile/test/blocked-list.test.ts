/**
 * The blocked list, in settings.
 *
 * A block is made on a photograph or a moment and undone here, by person. The
 * card has to say what a block does and that nobody is told, ask before
 * undoing one, and sit where the devices sheet does — signed in only.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const API = read('src/api.ts');
const BLOCKED = read('src/Blocked.tsx');
const EVENTS = read('src/Events.tsx');

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  if (end < 0) throw new Error(`anchor not found: ${to}`);
  return source.slice(start, end);
};

describe('the calls', () => {
  it('lists with a GET and unblocks by actor with a DELETE body', () => {
    expect(between(API, '  blocked(', '\n  }\n')).toMatch(/this\.call<\{ blocked: BlockedPerson\[\] \}>\('\/api\/blocks'\)/);
    const unblock = between(API, '  unblock(actorId', '\n  }\n');
    expect(unblock).toMatch(/method: 'DELETE'/);
    expect(unblock).toMatch(/body: JSON\.stringify\(\{ actorId \}\)/);
  });
});

describe('the card', () => {
  it('says what a block does, and that they are not told', () => {
    expect(BLOCKED).toMatch(/>Blocked</);
    expect(BLOCKED.replace(/\s+/g, ' ')).toMatch(
      /You and the people here do not see each other's photos, messages, comments or moments — even in albums and groups you share\. They are not told\./,
    );
    expect(BLOCKED).toMatch(/You have not blocked anyone\./);
  });

  it('loads on mount, asks before unblocking, and reloads after', () => {
    expect(BLOCKED).toMatch(/useEffect\(\(\) => \{\s*void load\(\);/);
    const unblock = between(BLOCKED, 'const unblock = useCallback', '[api, load],');
    expect(unblock).toMatch(/Alert\.alert/);
    expect(unblock).toMatch(/text: 'Cancel', style: 'cancel'/);
    expect(unblock).toMatch(/text: 'Unblock'/);
    expect(unblock).toMatch(/api\.unblock\(person\.actorId\)[\s\S]*await load\(\)[\s\S]*setNote/);
  });

  it('shows a face, a name and a handle on each row', () => {
    expect(BLOCKED).toMatch(/from 'expo-image'/);
    expect(BLOCKED).toMatch(/person\.avatarUrl/);
    expect(BLOCKED).toMatch(/@\{person\.handle\}/);
  });
});

describe('where it lives', () => {
  it('opens from the signed-in card, beside devices and passkeys', () => {
    const tail = between(EVENTS, '<Button label="Devices and passkeys"', '</View>');
    expect(tail).toMatch(/<Button label="Blocked" onPress=\{\(\) => setBlocking\(true\)\}/);
    expect(tail).toMatch(/\{blocking && \(\s*<BlockedCard api=\{api\} t=\{t\} Button=\{Button\}/);
  });
});
