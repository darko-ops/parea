/**
 * The arithmetic of Organize Rolls' two-across grid, apart from the drawing so
 * it can be tested without a phone. See `Shelf.tsx`.
 */

/** Which slot a point on the shelf is nearest, over `count` slots in two columns. */
export function slotAt(x: number, y: number, slotW: number, rowH: number, count: number): number {
  const maxRow = Math.ceil(count / 2) - 1;
  const col = Math.max(0, Math.min(1, Math.round(x / slotW)));
  const row = Math.max(0, Math.min(maxRow, Math.round(y / rowH)));
  return Math.min(row * 2 + col, count - 1);
}

/** `order` with `id` taken out and put back at `to`. */
export function moveTo(order: string[], id: string, to: number): string[] {
  const next = order.filter((other) => other !== id);
  next.splice(to, 0, id);
  return next;
}
