/**
 * Every screen's hooks run on every render of it.
 *
 * This is here because the group screen shipped unable to open. Two hooks —
 * `useWindowDimensions` and the `shelf` memo — sat below the `if (!group)`
 * return that draws the spinner. So the first render ran eleven hooks and the
 * render after the group arrived ran thirteen, React counts them by position,
 * and the second render is refused outright: *rendered more hooks than during
 * the previous render*. Not a wrong pixel. The screen did not draw.
 *
 * The rule is React's own and it is absolute: a component runs the same hooks
 * in the same order every time, so no hook may sit after a return that is
 * sometimes taken. Every screen in this app is written the same shape — fetch
 * into state, return a spinner while it is null, draw when it arrives — which
 * is exactly the shape that makes this easy to do by accident, and the cost
 * of doing it is the whole screen rather than a detail of it.
 *
 * ## Why this parses rather than greps
 *
 * The first version of this check was a regular expression over the source,
 * and it passed against the broken file. A test that cannot see the bug it
 * was written for is worse than no test, because it is also a claim. So this
 * walks the real syntax tree: a hook is a call whose callee is named `useX`,
 * an exit is a `return` among a component's own top-level statements, and
 * nested functions are not the component — a `useCallback` body may contain
 * whatever it likes.
 *
 * There is no ESLint in this repo, so `react-hooks/rules-of-hooks` is not
 * watching. Until there is, this is.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import type { Node } from '@babel/types';

const dir = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url).href);

/** Every file that draws something: the screens, and the app that holds them. */
function sources(): string[] {
  const src = 'src';
  const screens = readdirSync(dir(src))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `${src}/${f}`);
  return [...screens, 'App.tsx'];
}

type Fn = { type: string; body?: unknown; params?: unknown[]; id?: { name?: string } | null };

const isFn = (node: Node | null | undefined): boolean =>
  !!node &&
  (node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression');

/** `useThing(...)` — an identifier or a `React.useThing` member. */
function hookName(node: Node): string | null {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee as Node;
  if (callee.type === 'Identifier') return /^use[A-Z]/.test(callee.name) ? callee.name : null;
  if (callee.type === 'MemberExpression' && (callee.property as Node).type === 'Identifier') {
    const name = (callee.property as { name: string }).name;
    return /^use[A-Z]/.test(name) ? name : null;
  }
  return null;
}

/**
 * Walk a subtree, stopping at any nested function.
 *
 * The bail has to happen on arrival at the function, not on the key holding
 * it: an arrow handed to `useEffect` sits in an `arguments` *array*, so a
 * parent-side check sees an array, descends, and reads the callback's body as
 * though it were the component's. That misread every `useEffect(() => { if
 * (!x) return; ... })` in the app as an early return and failed thirteen
 * files.
 */
function walk(node: unknown, visit: (n: Node) => void) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as Node;
  if (isFn(n)) return;
  if (n.type) visit(n);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk(value, visit);
  }
}

/** The component's own hook calls in this statement. */
function hooksIn(statement: Node) {
  const found: { name: string; line: number }[] = [];
  // The statement itself may be the call; `walk` skips only functions.
  walk(statement, (n) => {
    const name = hookName(n);
    if (name) found.push({ name, line: n.loc?.start.line ?? 0 });
  });
  return found;
}

/** Does this statement ever leave the component? */
function exits(statement: Node): boolean {
  let out = false;
  walk(statement, (n) => {
    if (n.type === 'ReturnStatement') out = true;
  });
  return out;
}

type Offence = { file: string; component: string; hook: string; line: number; exit: number };

function offences(source: string, file: string): Offence[] {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const out: Offence[] = [];

  function visit(node: unknown, name: string | null) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, name);
      return;
    }
    const n = node as Node & Fn;
    if (isFn(n) && (n.body as Node)?.type === 'BlockStatement') {
      const own = name ?? (n.id?.name ?? null);
      // Components and custom hooks are the only functions the rule binds.
      if (own && /^(?:[A-Z]|use[A-Z])/.test(own)) {
        const body = (n.body as { body: Node[] }).body;
        let exitedAt = 0;
        for (const statement of body) {
          if (exitedAt) {
            for (const hook of hooksIn(statement)) {
              out.push({
                file,
                component: own,
                hook: hook.name,
                line: hook.line,
                exit: exitedAt,
              });
            }
            continue;
          }
          if (exits(statement)) exitedAt = statement.loc?.start.line ?? 1;
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      // `const Thing = () => {}` and `function Thing()` both need the name.
      const named =
        (node as { type?: string }).type === 'VariableDeclarator' && key === 'init'
          ? ((node as { id?: { name?: string } }).id?.name ?? null)
          : null;
      visit(value, named);
    }
  }

  visit(ast.program.body, null);
  return out;
}

describe('hooks run in the same order on every render', () => {
  it.each(sources())('%s calls no hook after an early return', (file) => {
    const found = offences(readFileSync(dir(file), 'utf8'), file);
    const said = found.map(
      (o) => `${o.file}:${o.line} ${o.component} calls ${o.hook} after the return on line ${o.exit}`,
    );
    expect(said).toEqual([]);
  });

  it('sees the bug it was written for', () => {
    /*
     * The shape that shipped, reduced. If this stops failing, the check above
     * has stopped checking — which is what the regular expression this
     * replaced had quietly done.
     */
    const broken = `
      export function GroupScreen({ id }) {
        const [group, setGroup] = useState(null);
        if (!group) return <Waiting />;
        const { width } = useWindowDimensions();
        return <View style={{ width }} />;
      }
    `;
    const found = offences(broken, 'broken.tsx');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ component: 'GroupScreen', hook: 'useWindowDimensions' });
  });

  it('leaves a hook inside a callback alone', () => {
    // `useCallback(() => ...)` may hold anything; the rule is about the
    // component's own statements, and a check that cannot tell the difference
    // would fail every screen in the app.
    const fine = `
      export function Screen() {
        const [x, setX] = useState(0);
        const run = useCallback(() => { if (!x) return; doThing(x); }, [x]);
        if (!x) return null;
        return <View onLayout={run} />;
      }
    `;
    expect(offences(fine, 'fine.tsx')).toEqual([]);
  });
});
