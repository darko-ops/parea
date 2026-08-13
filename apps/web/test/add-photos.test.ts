/**
 * The one thing an event page is for.
 *
 * Adding photos was a bare `<input type="file">`: no label, no heading, no
 * colour, rendered by the browser as "Choose Files / No file chosen". That is
 * a sentence about a form, and it sat where the primary action of the whole
 * product should be — so the flow read as name it, place it, date it, get a
 * link, and stop. The same substitution had already been made for the avatar
 * picker and never reached here, which is the tell: it was not a decision.
 *
 * A default-rendered file input is invisible to every check a codebase
 * normally has. It typechecks, it renders, it works if you find it, and no
 * test fails. So the shape is asserted directly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const EVENT = read('../app/components/EventView.tsx');
const CREATE = read('../app/page.tsx');
const CSS = read('../app/globals.css');

describe('adding photos to an event', () => {
  it('is a button, not the browser default control', () => {
    expect(EVENT).toMatch(/<label[\s\S]{0,200}className="button-like primary"/);
    expect(EVENT).toMatch(/Add photos/);
  });

  it('hides the input the label drives', () => {
    // Both halves matter and they are in different places: the class does the
    // hiding, the id is what connects them. Losing the id leaves a styled
    // button that opens nothing, which looks completely fine.
    expect(EVENT).toMatch(/id="add-photos"/);
    expect(EVENT).toMatch(/htmlFor="add-photos"/);
    expect(EVENT).toMatch(/className="visually-hidden"/);
  });

  it('keeps the focus ring reachable', () => {
    // `visually-hidden` keeps the input focusable, so tab order still stops on
    // it — and without this rule that stop is on nothing a sighted keyboard
    // user can see.
    expect(CSS).toMatch(/input\.visually-hidden:focus-visible\) \.button-like/);
  });

  it('does not disable a label, which cannot be disabled', () => {
    // `disabled` on a <label> is inert. The real one belongs on the input, and
    // the label only says so.
    expect(EVENT).toMatch(/aria-disabled=\{uploads\.running/);
    expect(EVENT).toMatch(/disabled=\{uploads\.running\}/);
  });
});

describe('after an event is created', () => {
  it('offers adding photos as an action', () => {
    // This was a sentence with a link in it, under an otherwise empty column.
    expect(CREATE).toMatch(/className="button-like primary"[\s\S]{0,120}Add your photos/);
  });

  it('still does not navigate away on its own', () => {
    // The share panel is the reason this page does not redirect on success —
    // the second after making an event is when someone is most likely to send
    // the link, and a redirect takes it off the screen. So the new action is a
    // link to press, not a `location.href =`.
    expect(CREATE).not.toMatch(/location\.href\s*=\s*(link|created)/);
  });
});

describe('the share panel fits inside itself', () => {
  it('lets its grid items shrink', () => {
    // Grid items floor at `min-width: auto` — their min-content — and the row
    // in this panel holds a URL, which has no break opportunities at all. It
    // measured 433px inside a 328px box: the card's text spilled past its own
    // border and the whole page scrolled sideways. `.aside-link` was already
    // set to truncate and never got the chance.
    expect(CSS).toMatch(/\.aside > \*\s*\{[^}]*min-width:\s*0/);
  });
});
