/**
 * The access chokepoint — `src/access.ts`, and the whole security model.
 *
 * That file opens by saying route handlers must go through `guard`, that
 * nothing else should query the photo table, and that there is no path to a
 * photo which does not pass an event through it first. Until this test, that
 * was a comment. Comments do not fail.
 *
 * What a missing check costs is not abstract. Every event in this product is
 * reachable by a URL somebody was sent, and the only thing standing between a
 * stranger who guesses or is forwarded an id and two hundred photographs of
 * somebody's evening is one call at the top of a handler. A route that queries
 * `schema.photos` and forgets it does not look broken: it returns the right
 * data to the right person in every test anybody writes, because the person
 * writing it has access. It is wrong only for the people it was never shown
 * to, which is why nobody finds it.
 *
 * The two scans that already walk this tree check other things —
 * `egress-invariant.test.ts` watches for byte egress, `broken-images.test.ts`
 * for raw `<img>` — and neither looks at authorization at all.
 *
 * ## Three ways to be right, not one
 *
 * The comment says `guard`, but three shapes are legitimate and the test
 * accepts all three, because forcing everything onto `guard` would be a test
 * pushing the code somewhere worse:
 *
 *   1. `guard(...)` throws on refusal. The common case, and correct wherever
 *      the handler should simply stop.
 *   2. `decide(...)` returns the decision instead of throwing, for handlers
 *      that must look at *why* — `api/join` answers differently depending on
 *      the reason it was refused, and cannot do that with an exception.
 *   3. An ownership predicate: the query is scoped to the acting actor, as in
 *      `eq(schema.photos.uploaderId, actorId)`. `api/photos/[id]` DELETE is
 *      the real case — you may remove your own upload without the event
 *      having an opinion, and asking the event would be the wrong question.
 *
 * ## Why `decide` alone is not enough
 *
 * `decide` appears in two quite different roles and only one of them is an
 * authorization. In `api/events/[id]/photos` it is called to *report* —
 * `canAdminister: (await decide(...)).allow` — so the client knows whether to
 * draw a Manage link. Nothing is refused on the result. That handler's actual
 * authorization is the `guard` above it, and a rule that accepted any mention
 * of `decide` would have gone on passing after that `guard` was deleted.
 *
 * That is not a hypothetical either: it is the exact experiment this test was
 * checked against. So `decide` counts only when the file also refuses on the
 * decision it returned.
 *
 * ## No exemption list
 *
 * There is deliberately not one. `api/health` reports configuration names and
 * booleans, `api/groups/search` returns groups and is public by design, and
 * `api/events` POST creates — none of them *reads* event or photo data, so
 * none is reached by the rule in the first place. A list of paths permitted to
 * skip authorization is precisely the artefact this repository keeps being
 * bitten by: a MIME allow-list that ended up stated in three places, an EAS
 * profile pointing at a hostname nobody created. The second test below pins
 * the property that keeps those three out, so that a route which starts
 * reading events loses its exemption by doing so rather than keeping it
 * because a list was not updated.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = join(ROOT, 'app/api');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

/*
 * Comments off before anything is matched.
 *
 * Not optional here and not a regex: these files quote the patterns being
 * scanned for in their own headers, and a hand-rolled block-comment stripper
 * deletes real code — a comment opener is two characters that occur inside
 * ordinary strings, and the naive version cannot tell. A scan that never sees
 * a file reports nothing wrong with it. `support/source.ts` documents the two
 * times that happened here and is itself tested.
 */
async function readCode(path: string): Promise<string> {
  return stripComments(await readFile(path, 'utf8'));
}

async function routes(): Promise<{ path: string; source: string }[]> {
  const paths = await walk(API);
  return Promise.all(
    paths.map(async (path) => ({
      path: relative(ROOT, path),
      source: await readCode(path),
    })),
  );
}

/**
 * Whether a handler *reads* event or photo data.
 *
 * Inserts are removed first, and that is what lets the create route out
 * without naming it: `api/events` POST's only contact with the table is
 * `insert(schema.events)`, and there is nothing to authorize against a row
 * that does not exist yet. Its GET never touches the tables at all — it goes
 * through `eventsFor(db, actorId)`, which is scoped to the caller by its own
 * signature.
 */
function readsEventData(source: string): boolean {
  const withoutInserts = source.replace(/\.insert\(\s*schema\.\w+\s*\)/g, '');
  return (
    /\bschema\.(photos|events|derivatives)\b/.test(withoutInserts) ||
    /\bfindEventBy\w*\(/.test(withoutInserts)
  );
}

/** The throwing form. Refusal aborts the handler. */
const GUARDS = /\bguard\(/;

/**
 * The non-throwing form, and a refusal made from what it returned.
 *
 * Both halves are required. `decide` on its own is also how a handler asks a
 * question whose answer goes into the response body rather than into a
 * refusal, and that is not authorization however much it looks like it.
 */
const DECIDES = /\bdecide\(/;
const REFUSES = /if\s*\(\s*!\s*\w+(\.\w+)*\.allow|!\s*\(await\s+decide\([\s\S]*?\)\)\.allow/;

/**
 * Scoped to the acting actor.
 *
 * The authority is "it is mine", which the database enforces by the shape of
 * the query rather than the policy enforcing it by decision. Matched on an
 * equality between a column and the acting actor, whichever way round it is
 * written.
 */
const OWNS =
  /eq\(\s*schema\.\w+\.\w+\s*,\s*(actorId|viewerId)\s*\)|eq\(\s*(actorId|viewerId)\s*,\s*schema\.\w+\.\w+\s*\)/;

function authorizes(source: string): boolean {
  if (GUARDS.test(source)) return true;
  if (DECIDES.test(source) && REFUSES.test(source)) return true;
  return OWNS.test(source);
}

describe('every route that reads event data authorizes first', () => {
  it('found the route tree at all', async () => {
    // A resolution bug would empty the loop below and pass silently, which is
    // the one way this file could report on nothing and look green.
    const found = await routes();
    expect(found.length).toBeGreaterThanOrEqual(20);
    expect(found.some((r) => r.path.endsWith('app/api/events/[id]/photos/route.ts'))).toBe(
      true,
    );
  });

  it('has no handler reaching photos or events without one of the three', async () => {
    const offenders: string[] = [];
    for (const { path, source } of await routes()) {
      if (!readsEventData(source)) continue;
      if (!authorizes(source)) offenders.push(path);
    }
    expect(
      offenders,
      'these read event or photo data with no guard, no refused decision, and no ownership predicate',
    ).toEqual([]);
  });

  it('counts a decision only where something is refused on it', async () => {
    /*
     * The rule above is only worth anything because of this distinction, so it
     * is asserted directly rather than left implicit in a regex.
     *
     * `api/events/[id]/photos` calls `decide` twice and refuses on neither —
     * both answers are fields in the response. If `decide` alone counted, that
     * file would satisfy the rule with its `guard` removed, and the test would
     * be decorative.
     */
    const photos = await readCode(join(API, 'events/[id]/photos/route.ts'));
    expect(DECIDES.test(photos), 'expected the reporting form of decide').toBe(true);
    expect(REFUSES.test(photos), 'this file refuses on nothing; guard is its check').toBe(
      false,
    );
    expect(GUARDS.test(photos)).toBe(true);

    // And the other side of it: a handler that genuinely gates on a decision.
    const join_ = await readCode(join(API, 'join/route.ts'));
    expect(DECIDES.test(join_)).toBe(true);
    expect(REFUSES.test(join_)).toBe(true);
  });
});

describe('the routes that do not authorize, and why', () => {
  /*
   * Nothing here is an exemption. Each of these is outside the rule because of
   * something true about the file, and this pins that thing — so a route which
   * starts reading events is caught by the rule above rather than sitting on a
   * list somebody forgot to prune.
   */

  it('health reports configuration, never event data', async () => {
    const source = await readCode(join(API, 'health/route.ts'));
    expect(readsEventData(source)).toBe(false);
  });

  it('group search returns groups, and groups are the only findable thing', async () => {
    // Groups may be findable; photos and events never are. If this route ever
    // returns an event, it is no longer a public search.
    const source = await readCode(join(API, 'groups/search/route.ts'));
    expect(readsEventData(source)).toBe(false);
  });

  it('creating an event only ever inserts, and listing is scoped to the caller', async () => {
    const source = await readCode(join(API, 'events/route.ts'));
    expect(readsEventData(source), 'this route now reads events and must authorize').toBe(
      false,
    );
    // The two halves of why. Losing either makes the line above a lie: a read
    // of the table would be caught by the rule, but a listing that stopped
    // taking the actor would not be, and would quietly list everything.
    expect(source).toMatch(/\.insert\(\s*schema\.events\s*\)/);
    // `[^;]` rather than `[^)]`: the call is `eventsFor(getDb(), await
    // currentActorId())`, and stopping at the first bracket stops inside the
    // first argument.
    expect(source).toMatch(/eventsFor\([^;]*?[aA]ctorId/);
  });
});
