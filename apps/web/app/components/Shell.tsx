/**
 * The rail, and the page beside it.
 *
 * The rail existed on three pages — the landing form, Events and Find — which
 * meant navigation was a property of where you happened to be rather than of
 * the product. Open an event, a group, the privacy page or your own account
 * and the way back to anything vanished; the only route onward was the browser
 * back button, and on a page you arrived at from a link there is nothing
 * behind it.
 *
 * So this is the shape of a page, and pages are its children. Three lines
 * repeated across eight files is three lines that get out of step, and it is
 * `<div className="shell">` that would go missing first — a rail with no
 * flex parent renders as a full-width band above the content and looks like a
 * decision somebody made.
 *
 * The children bring their own `<main>`, because `.main` and `.wrap` are two
 * different pages: one runs to the edges for a grid of photographs, the other
 * is a 900px column for prose. Which one is not this component's business.
 *
 * Not in the root layout, which is where it would otherwise belong. The
 * sign-in screen is a white page with one card in the middle of it and no way
 * out that isn't signing in, and a layout applies to everything underneath it
 * including that. `Shell` is opted into instead, and a test asserts every page
 * that is not the sign-in screen opts in.
 *
 * Which makes it the one place every page with a reader on it passes through,
 * so it is also where the browser reports its time zone from — see
 * `ReaderZone`. Mounting that here rather than in the layout costs nothing and
 * means a page that arrives without ever showing a greeting still leaves the
 * zone behind for the page that will.
 */

import type { PartOfDay } from '@/greeting';

import { Rail, type RailPage } from './Rail';
import { ReaderZone } from './ReaderZone';

export function Shell({
  /**
   * The rail row to mark, or null. Exact matches only: `aria-current="page"`
   * on Events while you are looking at one specific event tells a screen
   * reader that this link goes to the page you are on, and it does not.
   */
  current = null,
  /**
   * The time of day this page greeted somebody with, or null for the pages
   * that do not — which is most of them, including every static one. The only
   * thing it is used for is deciding whether the greeting the server wrote is
   * the wrong one; a page that says nothing about the time of day cannot have
   * got it wrong, and passing it from here keeps that judgement next to the
   * render that made the claim.
   */
  at = null,
  children,
}: {
  current?: RailPage;
  at?: PartOfDay | null;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <ReaderZone served={at} />
      <Rail current={current} />
      {children}
    </div>
  );
}
