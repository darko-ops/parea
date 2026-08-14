/**
 * The links every page ends with.
 *
 * Six pages each hand-rolled their own and no two agreed: one listed five
 * links, one listed a single one, two called the same page "Safety, reporting
 * and contact" and two called it "Safety and reporting". The set a person sees
 * at the bottom of a page should not depend on which page they are on.
 *
 * Navigation is deliberately not in here. "Your events" and "Your account" are
 * destinations and live in the rail, which is on screen the whole time; a
 * footer repeating the navigation is a second menu that has to be kept in step
 * with the first.
 *
 * What is left is the three pages that have to be reachable from anywhere and
 * are not part of using the product: what to do about a photo or a person,
 * what we do with your data, and what you agreed to. Quiet, at the bottom, out
 * of the way of the thing you came to do — but on every page, because the
 * moment someone needs the first of them is not a moment to go looking.
 */
export function SiteFooter() {
  return (
    <>
      {/*
        The gap above the footer, as an element rather than a margin.

        It has to be two things at once: at least 56px of air after the content,
        and *all* the space left over when there is any — so that on a short
        page the links sit at the bottom of the screen instead of halfway up it
        with white space underneath, which reads as the page having ended early.
        `margin-top: auto` alone does the second and loses the first, because it
        resolves to zero as soon as the content fills the column. A spacer with
        `flex: 1; min-height: 56px` is both, said plainly.

        Outside a flex column it is simply 56px of blank space, which is what
        the margin was.
      */}
      <div className="footer-push" aria-hidden="true" />
      <footer className="site-footer">
        <a href="/safety">Safety and reporting</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </footer>
    </>
  );
}
