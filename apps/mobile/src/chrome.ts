/**
 * How much room the floating chrome takes, in one place.
 *
 * The tab bar is a bubble that floats over the content rather than sitting
 * under it, so every screen it covers has to reserve the space itself. Five
 * screens were reserving five different amounts — 110, 132 and 168 — which is
 * what happens when a number is arrived at by looking at a simulator: each one
 * was right on the day it was typed, on the phone it was typed for.
 *
 * The profile was the one that showed: at 110 the last row of albums sat far
 * enough under the bar to be unreadable, and that is the screen most likely to
 * end in a wall of pictures with nothing after it.
 *
 * So it is derived from the bar instead. The numbers below are the ones
 * `App.tsx` lays the bar out with, and the comment on each says which.
 */

/** `styles.tabShell.bottom` — how far the bubble floats off the bottom. */
const FLOAT = 28;
/** `styles.tabBar.padding` — the capsule's own inset, top and bottom. */
const BAR_PADDING = 8;
/** `styles.tab.paddingVertical`, twice, plus the 22pt glyph between them. */
const TAB_HEIGHT = 14 * 2 + 22;

/**
 * What the bar actually occupies, measured from the bottom of the screen.
 *
 * Roughly 94 points. Anything scrolling underneath it needs at least this
 * much, and wants more — see `BELOW_TABS`.
 */
export const TAB_BAR_HEIGHT = FLOAT + BAR_PADDING * 2 + TAB_HEIGHT;

/**
 * What a tab's scroll view should reserve at its foot.
 *
 * The bar's own height plus a gap, because clearing it exactly means the last
 * row stops precisely at the bar's edge — technically visible, and it reads as
 * content that has been cut off. The gap is the same 20 the tabs pad their
 * sides with, so the bottom margin matches the left and right ones.
 */
export const BELOW_TABS = TAB_BAR_HEIGHT + 20;
