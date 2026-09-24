/**
 * The one link on a profile, and what the field will accept.
 *
 * This matters more than its size suggests: the value is rendered on other
 * people's screens and handed to a browser when they tap it. A field that
 * takes whatever it is given is a field somebody puts a `javascript:` URL in.
 *
 * The route is called directly rather than asserted against, because a
 * refusal is the behaviour under test and source checks cannot see one.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { accountFor } = await import('@/accounts');
const { PATCH } = await import('../app/api/account/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;
let me: string;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`truncate "account", "actor" restart identity cascade`);
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: 'me@example.test' })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle: 'me' })
    .returning();
  me = actor!.id;
  headerBag.clear();
  headerBag.set('authorization', `Bearer ${sign(me)}`);
});

const save = (link: string) =>
  PATCH(
    new Request('https://parea.test/api/account', {
      method: 'PATCH',
      body: JSON.stringify({ link }),
    }),
  );

const stored = async () => (await accountFor(db, me))?.link ?? null;

describe('what the link field accepts', () => {
  it('adds the scheme somebody left off', async () => {
    // `parea.photos` is what a person types; `https://parea.photos` is what
    // opens. Https rather than http: guessing the insecure one is a guess that
    // can be listened to.
    expect((await save('parea.photos')).status).toBe(200);
    expect(await stored()).toBe('https://parea.photos/');
  });

  it('keeps a scheme somebody wrote', async () => {
    expect((await save('http://example.com/hello')).status).toBe(200);
    expect(await stored()).toBe('http://example.com/hello');
  });

  it('refuses anything that is not a web address', async () => {
    /*
     * `javascript:` is the one that matters — the value is rendered on
     * somebody else's screen and tapped there. `mailto:` is refused too, not
     * because it is dangerous but because a field that silently takes four
     * kinds of thing is a field nobody can predict.
     */
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:me@example.com',
      'tel:+15550100',
      'file:///etc/passwd',
    ]) {
      const answer = await save(bad);
      expect(answer.status, bad).toBe(400);
      expect(await stored(), bad).toBeNull();
    }
  });

  it('refuses a host with no dot in it', async () => {
    // `new URL('https://hello')` parses happily and resolves nowhere.
    expect((await save('hello')).status).toBe(400);
    expect(await stored()).toBeNull();
  });

  it('is cleared by an empty field rather than stored as one', async () => {
    await save('parea.photos');
    expect(await stored()).not.toBeNull();
    expect((await save('   ')).status).toBe(200);
    expect(await stored()).toBeNull();
  });

  it('is bounded, like everything else a person writes here', async () => {
    const long = `https://example.com/${'a'.repeat(400)}`;
    expect((await save(long)).status).toBe(200);
    expect((await stored())!.length).toBeLessThanOrEqual(200);
  });

  it('leaves the rest of the profile alone', async () => {
    // A PATCH names what it changes. Sending only a link must not clear a bio.
    await db
      .update(schema.actors)
      .set({ bio: 'Here for the photographs.' })
      .where((await import('drizzle-orm')).eq(schema.actors.id, me));
    await save('parea.photos');
    expect((await accountFor(db, me))?.bio).toBe('Here for the photographs.');
  });
});

/**
 * The profile as a page rather than as a phone screen.
 *
 * Source checks, because there is no DOM in this suite — they stand in for the
 * browser run that confirmed both widths.
 *
 * Three things were a phone's answers on a laptop, and the third is the one
 * that could quietly come back. The header was a centred column, the picture
 * floated in the middle of it, and the album grid — the same `.cards` rule the
 * home page draws — had a 640px column to fill, so it was two across on a
 * screen where Home is four. A profile is not a narrower product than the page
 * listing the same albums.
 */
describe('the profile at two widths', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const CSS = read('../app/globals.css');
  const VIEW = read('../app/components/AccountView.tsx');
  const SHARE = read('../app/components/ShareProfile.tsx');
  /** The rules that only apply on a laptop. */
  const WIDE = CSS.slice(CSS.indexOf('@media (min-width: 860px)'));

  it('hangs the picture from the top of the page on a phone', () => {
    /*
     * The app's shape: a strip the width of a face coming down from the top
     * edge with the square photograph at the foot of it, and above it the
     * photograph's own top edge stretched and blurred — so the space between
     * the picture and the chrome is the picture's colour rather than a swatch.
     *
     * The negative margin is what makes it *hang*: it pulls through `.wrap`'s
     * own 40px of top padding to meet the bar. The two numbers have to agree,
     * and nothing else in the file says so.
     */
    expect(VIEW).toMatch(/className="you-ribbon"/);
    expect(CSS).toMatch(/\.you-ribbon \{[^}]*margin-top: -40px/);
    expect(CSS).toMatch(/\.wrap \{[^}]*padding: 40px/);
    // Bottom corners only: the top of it is not an edge, it is where the page
    // begins.
    expect(CSS).toMatch(/\.you-ribbon \{[^}]*border-radius: 0 0 24px 24px/);
  });

  it('stretches the picture from its own top edge, not from a fifth of it', () => {
    /*
     * Arithmetic rather than a number somebody liked: the picture is 172 wide
     * and square, so filling 72px of strip from its top 10px means scaling it
     * to 172 × 7.2 = 1238, which against a 72px box is 1720%.
     *
     * It said 560% first, which showed the top fifth of the photograph — a
     * washed-out slice of sky that did not match the sky directly under it,
     * which is what a seam is. Asserted because the number is unreadable
     * without the derivation beside it, and therefore easy to "tidy".
     */
    const bleed = CSS.slice(CSS.indexOf('.you-bleed {'), CSS.indexOf('}', CSS.indexOf('.you-bleed {')));
    expect(bleed).toMatch(/background-size: 100% 1720%/);
    expect(bleed).toMatch(/height: 72px; margin: -14px 0/);
    // Mirrored, so the row meeting the photograph is its own first row.
    expect(bleed).toMatch(/transform: scaleY\(-1\)/);
  });

  it('puts the picture on the side and reads from the left on a laptop', () => {
    expect(WIDE).toMatch(/\.you-head \{[^}]*flex-direction: row/);
    expect(WIDE).toMatch(/\.you-head \{[^}]*text-align: left/);
    // And stops hanging: a 172px band off a 1100px page is a phone's furniture
    // on a desk.
    expect(WIDE).toMatch(/\.you-bleed \{ display: none; \}/);
  });

  it('gives the albums the column the home page gives them', () => {
    /*
     * The same container, not merely a wider one. Both draw the identical
     * `.cards` grid, so anything less is the profile answering "how many fit
     * across" differently from the page listing the same albums — at 1100 a
     * 1500px screen gives Home four and the profile three, and nobody can
     * attribute that difference to anything.
     */
    expect(WIDE).toMatch(/\.you \{ max-width: none; padding: 28px 30px 34px; \}/);
    expect(CSS).toMatch(/\.main \{[^}]*padding: 28px 30px/);
  });

  it('offers the profile to somebody, and says which way before it does', () => {
    /*
     * A button reading `Share` that silently copies looks broken to whoever
     * expected a sheet, and one reading `Copy link` that opens a sheet is the
     * reverse. Decided after mount because `navigator` is not a thing during
     * render, and a label that changes on hydration is worse than one that
     * arrives a frame late.
     */
    expect(SHARE).toMatch(/\{sheet \? 'Share' : 'Copy link'\}/);
    expect(SHARE).toMatch(/useEffect\(\(\) => \{\s*\n\s*setSheet\(/);
    // Built from the page's own origin: a link copied on a preview should open
    // that preview, which is the case where a wrong link is hardest to notice.
    expect(SHARE).toMatch(/new URL\(`\/u\/\$\{handle\}`, window\.location\.origin\)/);
    // Nothing to hand out without a handle, and dimmed rather than absent —
    // a row with one half missing reads as a layout that failed.
    expect(SHARE).toMatch(/disabled=\{!handle\}/);
  });
});
