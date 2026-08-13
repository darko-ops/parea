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
    <footer className="site-footer">
      <a href="/safety">Safety and reporting</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </footer>
  );
}
