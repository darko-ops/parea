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
  it('is a control somebody can find, not the browser default', () => {
    // The shape moved — the filled button became an item inside the `+` menu
    // in the head — but the property being defended did not: a `<label>` for
    // the input rather than the input itself, which the browser renders as
    // "Choose Files / No file chosen".
    expect(EVENT).toMatch(/<label\b/);
    expect(EVENT).toMatch(/Add photos/);
    // That the input itself is hidden is the next test's job — asserting it
    // here as a negative match needs the attributes in a fixed order, which
    // they are not: the class sits three lines above the type.
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

  it('says what it does, in the header, as the one filled control', () => {
    /*
     * It was behind a filled `+` menu, which made the page's main action a
     * glyph somebody had to open to find out about. The header says the words
     * now — and it is still the only filled thing on it, because a page whose
     * subject is photographs has exactly one action worth colouring.
     */
    expect(EVENT).toMatch(/className="button-like primary event-add"/);
    expect(EVENT).toMatch(/uploads\.running \? 'Adding…' : 'Add photos'/);
  });

  it('is offered again in the gallery, on the same input', () => {
    // The first tile. One file dialog and one disabled state — two controls
    // wired to two inputs is how a page ends up with two half-working ones.
    expect(EVENT).toMatch(/<label htmlFor="add-photos" className="tile-add">/);
    expect(EVENT).toMatch(/id="add-photos"/);
  });

  it('does not disable a label, which cannot be disabled', () => {
    // `disabled` on a <label> is inert. The real one belongs on the input, and
    // the label only says so.
    expect(EVENT).toMatch(/aria-disabled=\{uploads\.running/);
    expect(EVENT).toMatch(/disabled=\{uploads\.running\}/);
  });
});

describe('after an event is created', () => {
  /*
   * This pair used to say the opposite, and the reversal is deliberate.
   *
   * The old rule was that creating must *not* navigate: the page ended on a
   * panel holding the link, on the reasoning that the second after making an
   * event is when somebody sends it. What that actually produced was a screen
   * between a person and the event they had just made — with a button on it
   * saying "Add your photos", for photos that were already uploading.
   *
   * So the event is where it ends now, and the share panel lives inside it,
   * one press from the same second. What still has to hold is that the photos
   * are not abandoned at the door: they are written to the queue before the
   * navigation, and the event page picks them up.
   */
  it('goes to the event it just made', () => {
    expect(CREATE).toMatch(/location\.href = `\/event\/\$\{created\.id\}`/);
  });

  it('hands the photos over before it goes', () => {
    // Order, not presence: navigating first leaves the queue unwritten and the
    // photographs on the floor.
    const stage = CREATE.indexOf('uploads.stage(');
    const leave = CREATE.indexOf('location.href = `/event/');
    expect(stage).toBeGreaterThan(-1);
    expect(stage).toBeLessThan(leave);
  });
});

describe('the share panel fits inside itself', () => {
  it('lets its grid items shrink', () => {
    // Grid items floor at `min-width: auto` — their min-content — and the row
    // in this panel holds a URL, which has no break opportunities at all. It
    // measured 433px inside a 328px box: the card's text spilled past its own
    // border and the whole page scrolled sideways. `.aside-link` was already
    // set to truncate and never got the chance.
    // The row moved into the share panel when the create screen's aside was
    // deleted; the rule that keeps it inside its box moved with it.
    expect(CSS).toMatch(/\.share-card > \*\s*\{[^}]*min-width:\s*0/);
  });
});
