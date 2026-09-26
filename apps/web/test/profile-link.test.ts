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
     * The negative margin is what makes it *hang*: it pulls back through the
     * page's own top padding to meet the bar. Which number that is depends on
     * the container — see the test below.
     */
    expect(VIEW).toMatch(/className="you-ribbon"/);
    expect(CSS).toMatch(/\.you-ribbon \{[^}]*margin-top: calc\(var\(--page-top/);
    // Bottom corners only: the top of it is not an edge, it is where the page
    // begins.
    expect(CSS).toMatch(/\.you-ribbon \{[^}]*border-radius: 0 0 24px 24px/);
  });

  it('puts nothing between the picture and the bar', () => {
    /*
     * The phone bleeds the photograph's top edge into a blurred strip above
     * it, and the reason is hardware: there is a camera island up there, and a
     * face drawn into it is a face with a lens through it — the bleed fills
     * the space the island takes. A browser has no island and no such space,
     * so the strip was a phone's answer to a question a page does not ask.
     *
     * Asserted as an absence because that is what it is: any element between
     * the ribbon's top edge and the photograph is the strip coming back.
     */
    expect(CSS).not.toMatch(/\.you-bleed/);
    expect(VIEW).not.toMatch(/you-bleed/);
    expect(read('../app/components/PersonView.tsx')).not.toMatch(/you-bleed/);
  });

  it('puts the picture on the side and reads from the left on a laptop', () => {
    expect(WIDE).toMatch(/\.you-head \{[^}]*flex-direction: row/);
    expect(WIDE).toMatch(/\.you-head \{[^}]*text-align: left/);
    // And stops hanging: a 172px band off a 1100px page is a phone's furniture
    // on a desk, so it keeps its own corners and its own margin.
    expect(WIDE).toMatch(/\.you-ribbon \{[^}]*margin-top: 4px; border-radius: 20px/);
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

  it('gives somebody else\u2019s profile the same page', () => {
    /*
     * It is the same page about a different person, so it is the same ribbon
     * and the same row on a laptop. What it is not is the same *actions*:
     * `Edit` has no meaning here, and neither, it turns out, does Share.
     *
     * Share went because the argument for it was the argument against it. A
     * browser has this page's address in the bar, so a button that copies it
     * offers to do what the reader can already see how to do — and it was
     * taking a third of a row whose other two are the things only this page
     * can do. The app never had one here. Your own profile keeps it, where it
     * hands out a link to a page nobody can look up.
     *
     * Two things in one order: Chat, then the friend decision, because last
     * is where the control that changes what the two of you are should sit.
     */
    const PERSON = read('../app/components/PersonView.tsx');
    expect(PERSON).toMatch(/className="you-ribbon"/);
    expect(PERSON).not.toMatch(/ShareProfile/);
    // Still on your own, which is the page a shared link is for.
    expect(read('../app/components/AccountView.tsx')).toMatch(/<ShareProfile handle=/);
    const act = PERSON.slice(PERSON.indexOf('className="you-act"'));
    expect(act.indexOf('onClick={chat}')).toBeLessThan(act.indexOf("standing === 'friends'"));
  });

  it('gives the two controls one shape', () => {
    /*
     * A friend's profile showed a 13px bordered pill next to a 12.5px rounded
     * chip: two controls with nothing in common but the row they sat on. They
     * are the two halves of one question — what do you want to do about this
     * person — and the page was answering it for the reader by drawing one of
     * them as a different kind of object.
     *
     * So "Friends" is shaped as the button beside it, and "Add friend" stopped
     * being the one filled control on the row. The numbers are repeated in
     * `.you-state` rather than shared, because the button rules are written
     * against `button` and widening them to a bare class would reach every
     * `.small` on the site — which is why this test holds the pair together.
     */
    const PERSON = read('../app/components/PersonView.tsx');
    expect(PERSON).toMatch(/<span className="you-state">Friends<\/span>/);
    expect(PERSON).not.toMatch(/className="pip">Friends/);
    expect(PERSON).toMatch(/className="secondary small" disabled=\{busy\} onClick=\{ask\}/);
    expect(CSS).toMatch(/button\.small \{ padding: 7px 11px; font-size: 13px; border-radius: 8px; \}/);
    expect(CSS).toMatch(/\.you-state \{[^}]*padding: 7px 11px; font-size: 13px; font-weight: 600;/);
    expect(CSS).toMatch(/\.you-state \{[^}]*border-radius: 8px; border: 1px solid var\(--line\)/);
    expect(CSS).toMatch(/button\.secondary \{\s*background: transparent; color: var\(--fg\); border: 1px solid var\(--line\)/);
  });

  it('pulls the ribbon back through whichever page it is on', () => {
    /*
     * Your own profile is in `.wrap` and somebody else's is in `.main`, and
     * those two have never had the same top padding — 40, 28, and 20 on a
     * phone. A single `-40px` hangs one of them off the bar and pulls the
     * other twelve pixels past it.
     *
     * So the pull is the container's own number, declared where the padding
     * is. Asserted on all three, because a fourth padding added without the
     * variable beside it is the bug coming back.
     */
    expect(CSS).toMatch(/\.you-ribbon \{[^}]*margin-top: calc\(var\(--page-top, 40px\) \* -1\)/);
    expect(CSS).toMatch(/\.wrap \{[^}]*--page-top: 40px;[^}]*padding: 40px/);
    expect(CSS).toMatch(/\.main \{\s*--page-top: 28px;[^}]*padding: 28px 30px/);
    expect(CSS).toMatch(/\.main \{ --page-top: 20px; padding: 20px; \}/);
  });

  it('draws the link, on both profiles, under the counts', () => {
    /*
     * The field is validated at length above and was rendered nowhere on the
     * web: your own profile printed a name, a bio and three numbers, and
     * somebody else's page did not even receive the value. A link whose whole
     * purpose is other people's screens, kept off every screen.
     *
     * Under the counts and above nothing, which is where the app puts it: the
     * line above is what this person has, and an address is the same kind of
     * thing. A real anchor on both — checking that what you typed opens is most
     * of what somebody wants from seeing their own link — with `nofollow ugc`
     * because somebody else wrote it and the page is not an endorsement, and
     * `noopener` with the new tab so the profile is still behind you.
     *
     * Shown without its scheme and truncated rather than wrapped; the `href`
     * keeps the scheme, because a scheme-less href is a path on this site.
     */
    const PERSON = read('../app/components/PersonView.tsx');
    for (const source of [VIEW, PERSON]) {
      expect(source).toMatch(/className="you-link"/);
      expect(source).toMatch(/rel="nofollow ugc noopener noreferrer"/);
      expect(source).toMatch(/target="_blank"/);
      expect(source).toMatch(/replace\(\/\^https\?:\\\/\\\/\/, ''\)/);
      // After the counts, not above them and not under the bio.
      expect(source.indexOf('className="you-link"')).toBeGreaterThan(
        source.indexOf('className="you-counts"'),
      );
    }
    // And sent to the app's version of the page from the same payload, so one
    // screen cannot have a link the other does not.
    expect(read('../app/api/people/[handle]/route.ts')).toMatch(/link: person\.link,/);
    expect(CSS).toMatch(/\.you-link \{[^}]*margin: 6px 0 0; font-size: 14\.5px/);
    expect(CSS).toMatch(/\.you-link \{[^}]*text-overflow: ellipsis/);
    expect(CSS).toMatch(/\.you-link a \{ color: var\(--accent\)/);
  });

  it('lays their albums out in the grid every other shelf uses', () => {
    /*
     * There is no rule for this at the wide breakpoint any more, and that is
     * the change. `.album-list` was a column of 52px rows that the laptop
     * block widened into columns of its own; the shelf is `.cards` now — the
     * same grid the home page and your own profile answer this width with — so
     * a profile and the page listing the same albums cannot disagree about how
     * many fit across.
     */
    const PERSON = read('../app/components/PersonView.tsx');
    expect(PERSON).toMatch(/<ul className="cards album-shelf">/);
    expect(PERSON).not.toMatch(/album-list|album-row|album-card/);
    expect(WIDE).not.toMatch(/\.album-list/);
    // The grid itself, unchanged and shared.
    expect(CSS).toMatch(
      /\.cards \{\s*display: grid; gap: 20px;\s*grid-template-columns: repeat\(auto-fill, minmax\(290px, 1fr\)\);/,
    );
  });

  it('puts two albums across a phone, on a profile and nowhere else', () => {
    /*
     * One album per screenful is right on the home page, where the card is
     * what somebody came to look at. A profile is a different question —
     * what does this person have — and answering it one tall cover at a time
     * makes a shelf into a scroll. The app has always drawn two across; the
     * browser drew one.
     *
     * Scoped to `.you-events`, which is both profiles and nothing else, and
     * two explicit columns rather than a `minmax` that happens to fit two at
     * one width and one at another.
     *
     * The cover takes the letterbox this stylesheet already falls back to,
     * and the `[style]` selector is beaten with it: a portrait cover sets its
     * own `aspect-ratio` inline, and at half width that is a column of one
     * album again wearing a different rule.
     */
    expect(CSS).toMatch(
      /\.you-events \.cards \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(CSS).toMatch(
      /\.you-events \.card-cover\[style\*="--card-aspect"\]\s*\{[^}]*aspect-ratio: 3 \/ 2/,
    );
    // Both profiles wrap their shelves in it, which is what makes one rule
    // reach the pair.
    expect(read('../app/components/AccountView.tsx')).toMatch(/className="you-events"/);
    expect(read('../app/components/PersonView.tsx')).toMatch(/className="you-events"/);
  });

  it('draws a shut album as shut rather than as empty', () => {
    /*
     * The one thing rows were better at. A locked album has no photograph to
     * show, and a card with nothing in it reads as a picture that failed to
     * arrive — which was the whole argument for a list of 52px rows.
     *
     * So it is not empty, it is hatched, with the padlock an album's own
     * header wears and the phone's tile already draws. An unlocked album with
     * no cover yet keeps the flat rectangle: nothing is being withheld there,
     * and hatching it would say something untrue.
     */
    const PERSON = read('../app/components/PersonView.tsx');
    expect(PERSON).toMatch(/album\.locked && \(\s*<span className="album-shut"/);
    expect(CSS).toMatch(/\.album-shut \{[^}]*position: absolute; inset: 0;/);
    expect(CSS).toMatch(/\.album-shut \{[^}]*repeating-linear-gradient/);
    /*
     * With a base colour under the stripes. `.card-cover` is already
     * `--hairline`, so hatching in `--hairline` over `transparent` paints a
     * flat grey rectangle with a padlock on it — which is the "empty" this
     * panel exists not to look like. Caught by putting it on a screen.
     */
    expect(CSS).toMatch(/\.album-shut \{[^}]*var\(--line\), var\(--line\) 2px/);
    expect(CSS).toMatch(/\.album-shut \{[^}]*\),\s*var\(--card\);/);
    // The cover itself is the same component the cards above use, so an
    // expired URL leaves a flat rectangle rather than a broken-image glyph.
    expect(PERSON).toMatch(/<CoverImage src=\{album\.cover\} sources=\{\[\]\} \/>/);
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
    // Its own class, not `Edit`'s borrowed. See `person-page.test.ts`.
    expect(SHARE).toMatch(/className="you-share"/);
  });
});
