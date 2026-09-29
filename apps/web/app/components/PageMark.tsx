/**
 * The name, at the top of a page.
 *
 * The wordmark takes the centre the greeting used to hold — the greeting
 * moves to the leading side, clear of the search disc Chat keeps there — and
 * the rail above the rows wears the icon's glyph instead. The two traded
 * places: the rail is where the eye starts, and the glyph is the thing
 * people know from their home screen; the page's own header is where a name
 * reads as a title.
 *
 * Desktop only. On a phone the rail's bar carries the name already, and a
 * second one a thumb's width under it would be the same word twice. Hidden
 * from screen readers here for the same reason: the page's heading is the
 * greeting beside it.
 */

export function PageMark() {
  return (
    <span className="page-mark" aria-hidden="true">
      <span className="wordmark">Parea</span>
    </span>
  );
}
