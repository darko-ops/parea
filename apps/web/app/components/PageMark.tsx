/**
 * The mark, alone, at the top of a page.
 *
 * The three lenses without the icon's field behind them: on a page the
 * surface is already the ground, and a tile of colour in the middle of the
 * header would be the loudest thing above somebody's photographs. It takes
 * the centre the greeting used to hold — the greeting moves to the leading
 * side, clear of the search disc Chat keeps there — so every page with this
 * header opens the same way: who is reading on the left, whose product it is
 * in the middle, what you can do on the right.
 *
 * Desktop only. On a phone the header is the greeting, centred, and a mark
 * beside the rail's own would be the same logo twice in one screenful.
 * Decorative, as `Mark` itself says.
 */

import { Mark } from './Mark';

export function PageMark() {
  return (
    <span className="page-mark">
      <Mark size={30} />
    </span>
  );
}
