/**
 * Outer columns inside a select-list subquery, and why they are spelt out.
 *
 * Drizzle renders an interpolated column — `${schema.events.id}` — with its
 * table name only when the query it is in has a join. In a query without one,
 * the same interpolation becomes a bare `"id"`. In a WHERE clause that is
 * still fine, because the outer table is the only thing in scope. In a
 * *select-list* subquery it is not: the bare name resolves against the
 * subquery's own table first, and most tables in this schema have an `id`, an
 * `event_id` or a `group_id` of their own.
 *
 * The result is valid SQL over a real column with no error and no warning,
 * and a source line that reads exactly as intended. It has cost this codebase
 * two bugs in one query:
 *
 *   - `p.event_id = ${schema.events.id}` became `p.event_id = p.id`, so every
 *     album on every profile printed zero photographs;
 *   - `gm.group_id = ${schema.events.groupId}` became `gm.group_id =
 *     gm.group_id`, true of every row — so "is the viewer in this album's
 *     group" became "is the viewer in any group", and anybody who was saw
 *     every private album on every profile unlocked, cover and count.
 *
 * So the rule is: a correlated subquery in a select list names its outer
 * column literally — `"event".id` — the way `groupArchive`, `EVENT_SHOT` and
 * `FRESH` already do. This scan holds it, because the failure is invisible in
 * review and invisible at runtime.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Every `name: sql<...>`(...)`,` value in a select list, with its file and line.
 *
 * Braces are counted rather than matched with a regex: these templates hold
 * `${...}` interpolations and nested parentheses, and a lazy match to the
 * first `)` ends halfway through the first subquery.
 */
function selectListTemplates(source: string, file: string) {
  const found: { file: string; line: number; body: string }[] = [];
  const opener = /^[ \t]*[A-Za-z_][A-Za-z0-9_]*: sql<[^>]*>`\(/gm;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === '`' && source[i - 1] !== '\\') break;
    }
    found.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      body: source.slice(start, i),
    });
  }
  return found;
}

describe('a correlated subquery in a select list', () => {
  it('never reaches its outer column through an interpolated column', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SRC)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(`${SRC}/${name}`, 'utf8');
      for (const template of selectListTemplates(source, name)) {
        // Only the correlated ones: a subquery with its own FROM is where a
        // bare outer name can be captured by an inner table.
        if (!/\bfrom\s+"/.test(template.body)) continue;
        if (/\$\{schema\.[A-Za-z]+\.[A-Za-z]+\}/.test(template.body)) {
          offenders.push(`${template.file}:${template.line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the templates it means to scan', () => {
    // A scan that matches nothing passes for the wrong reason, and this one
    // has to keep finding the shapes it was written against.
    const people = readFileSync(`${SRC}/people.ts`, 'utf8');
    const found = selectListTemplates(people, 'people.ts');
    expect(found.length).toBeGreaterThan(3);
    expect(found.some((t) => /group_member/.test(t.body))).toBe(true);
    // And it would have caught the bug: the same template with the
    // interpolation back in it is an offender.
    const broken = 'x: sql<boolean>`(\n select 1 from "group_member" gm\n where gm.group_id = ${schema.events.groupId}\n)`,';
    const [one] = selectListTemplates(broken, 'x.ts');
    expect(/\$\{schema\.[A-Za-z]+\.[A-Za-z]+\}/.test(one!.body)).toBe(true);
  });
});
