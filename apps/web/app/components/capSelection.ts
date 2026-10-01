/**
 * What fits of a selection, given how many are already waiting.
 *
 * `<input type="file" multiple>` has no way to limit how many are chosen, so
 * the limit is applied after the pick: the first ones, in the order the
 * picker gave them, up to `max` in all. The rest are counted rather than lost
 * silently, so the page can say so.
 */
export function capSelection<T>(
  existing: number,
  picked: readonly T[],
  max: number,
): { kept: T[]; dropped: number } {
  const room = Math.max(0, max - existing);
  const kept = picked.slice(0, room);
  return { kept, dropped: picked.length - kept.length };
}

/** The line shown when a pick went over. `kept` is how many of it were taken. */
export function selectionNote(kept: number, max: number): string {
  return kept === max
    ? `Up to ${max} photos at a time — kept the first ${max}. You can add more once these are in.`
    : kept === 0
      ? `Up to ${max} photos at a time, and ${max} are already picked. You can add more once these are in.`
      : `Up to ${max} photos at a time — kept ${kept}. You can add more once these are in.`;
}
