/**
 * Creating an event, and the window that comes with it — design §3, §7.3.
 *
 * The window is the interesting half. `event.starts_at` / `ends_at` have been
 * in the schema since the first migration and no client set them until the
 * native create screen existed, so this is the first code that has ever had to
 * decide what a bad one looks like.
 *
 * §17 states the asymmetry: *a wrong window is worse than no window*. Nothing
 * downstream can detect one — `resolveWindow` will happily resolve against a
 * reversed or open interval, and the only symptom is a contributor being shown
 * forty pre-ticked photos from the wrong day.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseWindow } from '../src/eventwindow';

const source = readFileSync(
  fileURLToPath(new URL('../app/api/events/route.ts', import.meta.url)),
  'utf8',
);

const START = '2026-07-18T18:00:00.000Z';
const END = '2026-07-19T03:00:00.000Z';

describe('the window a creator sends', () => {
  it('is accepted when it runs forwards', () => {
    const window = parseWindow(START, END) as { startsAt: Date; endsAt: Date };
    expect(window.startsAt.toISOString()).toBe(START);
    expect(window.endsAt.toISOString()).toBe(END);
  });

  it('is absent when neither end is given', () => {
    // "Not sure yet" is a real answer, and it must not be an error.
    expect(parseWindow(undefined, undefined)).toBeNull();
    expect(parseWindow(null, null)).toBeNull();
  });

  it('is refused when it runs backwards', () => {
    expect(parseWindow(END, START)).toBe('invalid');
  });

  it('is refused when it has no duration', () => {
    expect(parseWindow(START, START)).toBe('invalid');
  });

  it('is refused when only one end is given', () => {
    // Half a window resolves against an open interval, which is every photo
    // on the contributor's device.
    expect(parseWindow(START, undefined)).toBe('invalid');
    expect(parseWindow(undefined, END)).toBe('invalid');
  });

  it('is refused when a date is not a date', () => {
    expect(parseWindow('tonight', END)).toBe('invalid');
    expect(parseWindow(START, 12345)).toBe('invalid');
  });
});

describe('the clients that send one', () => {
  /*
   * One client now, and it used to be two.
   *
   * The web form stopped asking. That is a product decision rather than a
   * regression — the question bought auto-selection, which is a native feature
   * (a browser cannot read a camera roll), so the web was collecting an answer
   * to a question only the phone can use. The route still takes a window and
   * still refuses a bad one; the phone still sends it.
   *
   * The gap the rest of this closes was invisible for the life of the project:
   * the schema had the columns, the design said they were captured at
   * creation, the create page's own comment said it asked for them — and
   * nothing ever sent one. Nothing failed, because a null window is a
   * legitimate answer.
   */
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('the web form asks nothing about when, and sends nothing', () => {
    // Both halves. A form that still imported the presets and quietly sent no
    // window would be the same silent gap this file exists to close, from the
    // other direction.
    const web = read('../app/page.tsx');
    expect(web).not.toContain('WHEN_OPTIONS');
    expect(web).not.toMatch(/startsAt|endsAt/);
  });

  it.each([['the native create screen', '../../mobile/src/CreateEvent.tsx']])(
    '%s sends startsAt and endsAt',
    (_label, path) => {
    const client = read(path);
    /*
     * The identifier is not the point, and pinning its shape was a false
     * failure waiting to happen — which is what it turned out to be twice. The
     * native screen reads its window off the photographs somebody chose now and
     * derives the two ends separately from one nullable `span`.
     *
     * What has to hold is unchanged and is the whole reason this test exists:
     * both ends come from the *same* nullable source, so the pair is sent
     * together or not at all. Half a window resolves against an open interval,
     * which is every photograph on a device.
     */
    const starts = client.match(/const startsAt = (\w+) \?/)?.[1];
    const ends = client.match(/const endsAt = (\w+) \?/)?.[1];
    expect(starts, 'startsAt is not derived from a nullable window').toBeTruthy();
    expect(ends, 'endsAt is not derived from a nullable window').toBeTruthy();
    expect(starts).toBe(ends);
    // And both fall back to null rather than to a bound of their own.
    expect(client).toMatch(/const startsAt = \w+ \? [^;]+ : null;/);
    expect(client).toMatch(/const endsAt = \w+ \? [^;]+ : null;/);
    },
  );

  it('the native create screen no longer asks when it was at all', () => {
    /*
     * This used to assert that the screen took its phrasing from
     * `@parea/autoselect`, so that two copies of the preset list could not
     * drift on what "Tonight" means. There is no list now: making an album
     * begins by choosing the photographs, and their first and last shutter is
     * the window — exactly, rather than a phrase resolved to a six-hour box.
     *
     * So the guard inverts. The screen must *not* carry a phrase list, because
     * a second way of answering the same question is how the two would disagree.
     */
    const client = read('../../mobile/src/CreateEvent.tsx');
    /*
     * Comments out before looking. The note explaining where the date's
     * construction came from names `eventDateFor`, and a check that cannot tell
     * prose from code fails on the explanation for the thing it is checking.
     */
    const body = client
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toContain('WHEN_OPTIONS');
    expect(body).not.toMatch(/windowFor|eventDateFor/);
    // The window comes from the selection instead.
    expect(body).toMatch(/windowOf\(chosen\)/);
  });

  /*
   * Nothing is pre-selected, so a submit control has to wait for an answer
   * rather than letting the question be skipped past. "Not sure yet" is one of
   * the answers; skipping is not.
   *
   * Read from the source, which is a proxy and worth naming as one: what would
   * really settle it is rendering the screen and finding the button
   * unpressable, and neither client has a rendering test. This asserts the
   * next best thing — that every submit control is guarded, and that the guard
   * takes the window state into account.
   *
   * It has already been too literal twice. Pinned to `!when`, it failed the
   * moment native moved the same rule into a named `ready`, which was a
   * refactor rather than a regression. Applied to every `disabled` on the
   * page, it failed again when the web form grew a second step and a "back to
   * the photos" button — a control that moves between parts of the form, which
   * this rule was never about and which must not be gated on an answer the
   * person is going back to change.
   *
   * So it reads the control that submits. Where the file marks one, those are
   * the guards that matter; where it does not, every guard is a candidate and
   * the rule stays as strict as it was.
   */
  it.each([['the native create screen', '../../mobile/src/CreateEvent.tsx']])(
    '%s guards the control that creates the event',
    (_label, path) => {
    const client = read(path);
    const submits = client
      .split('<button')
      .filter((block) => /type="submit"/.test(block.slice(0, block.indexOf('>'))));

    const guards = (submits.length > 0 ? submits : [client]).flatMap((block) =>
      [...block.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1]!),
    );

      expect(guards.length).toBeGreaterThan(0);
      for (const guard of guards) {
        // Either the window state directly, or a named rule defined in terms
        // of it — checked below.
        expect(guard, guard).toMatch(/when|ready/);
      }
    },
  );

  it('the native create screen still refuses to submit without a name', () => {
    /*
     * This used to require the *window* to be in the guard, because the window
     * was a question somebody could skip past. It is not one any more — it is
     * read off the photographs — so what is left to insist on is the name,
     * which is the same thing the web form guards and for the same reason: a
     * submit control that cannot be pressed past an unanswered required
     * question.
     *
     * Deliberately not the photographs. An album with none is a real thing —
     * made before the evening, or to hand the link out at it.
     */
    const client = read('../../mobile/src/CreateEvent.tsx');
    const named = client.match(/const ready = ([^;]+);/)?.[1];
    expect(named, 'the native screen has no named submit rule').toBeTruthy();
    expect(named).toMatch(/name\.trim\(\)/);
    expect(client).toMatch(/disabled=\{busy \|\| !ready\}/);
  });

  it('the web form still refuses to submit without a name', () => {
    // What the guard rule was really protecting: a submit control that cannot
    // be pressed past an unanswered required question. On the web that is now
    // the title, which is the only thing an event cannot be made without.
    const web = read('../app/page.tsx');
    const submit = web.slice(web.indexOf('type="submit"'));
    expect(submit.slice(0, 200)).toMatch(/disabled=\{[^}]*!name\.trim\(\)/);
  });
});

describe('the route', () => {
  it('answers 400 rather than storing a window it cannot trust', () => {
    expect(source).toContain("error: 'invalid_window'");
    expect(source).toMatch(/status: 400/);
  });

  it('persists the validated window, not the raw body', () => {
    // The bug this guards: validating and then inserting `body.startsAt`.
    expect(source).toMatch(/startsAt: window\?\.startsAt \?\? null/);
    expect(source).toMatch(/endsAt: window\?\.endsAt \?\? null/);
    expect(source).not.toMatch(/startsAt: asDate\(body/);
  });
});

/**
 * Who may create one, and who may see it afterwards.
 *
 * Both are new in the release that put an account on the contribution path.
 * Source-scanned for the same reason the window guard above is: there is no
 * rendering test, and the property worth pinning is that the route refuses
 * before it writes rather than after.
 */
describe('creating requires an account', () => {
  it('refuses a signed-out caller with a reason the client can act on', () => {
    expect(source).toContain("error: 'sign_in_required'");
    expect(source).toMatch(/status: 403/);
  });

  it('does not mint an actor before deciding', () => {
    // `ensureActor` creates a row. Calling it first would leave one behind for
    // every refused attempt — an unbounded write on an unauthenticated path.
    const gate = source.indexOf("error: 'sign_in_required'");
    const mint = source.indexOf('await ensureActor(');
    expect(gate).toBeGreaterThan(-1);
    expect(mint).toBeGreaterThan(gate);
  });

  it('reads the account from the database rather than trusting the request', () => {
    // A body field saying "I am signed in" would be exactly as good as no
    // check at all.
    expect(source).toMatch(/isSignedIn\(db, actorId\)/);
    expect(source).not.toMatch(/body\.(signedIn|hasAccount|accountId)/);
  });
});

describe('the access policy a creator chooses', () => {
  it('defaults to the open one when the client says nothing', () => {
    // Older clients send no such field, and the answer for them is the
    // behaviour they already had.
    expect(source).toMatch(/body\.accessPolicy === undefined \? PUBLIC/);
  });

  it('refuses anything that is not one it offers', () => {
    // Checked against a named list rather than a chain of `!==`. The list is
    // two long now and the check does not care: a policy that leaves is one
    // fewer name here, and the old values fall through to the 400 rather than
    // reaching a column `authorize` would fail closed on.
    expect(source).toContain("error: 'invalid_access_policy'");
    expect(source).toMatch(/const OFFERED = \[PUBLIC, PRIVATE\]/);
    expect(source).toMatch(/!OFFERED\.includes\(/);
  });

  it('persists the validated value, not the raw body', () => {
    // The same bug shape as the window above: validate one thing, insert
    // another. Here it would write a policy `authorize` does not recognise,
    // which fails closed and locks the creator out of their own event.
    expect(source).toMatch(/^\s*accessPolicy,$/m);
    expect(source).not.toMatch(/accessPolicy: body\.accessPolicy/);
  });
});
