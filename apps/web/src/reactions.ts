/**
 * What a message can be reacted with.
 *
 * Its own module, and the reason is a boundary rather than tidiness: the
 * thread is a client component and needs this list to draw the picker, while
 * `messages.ts` reads the database and presigns avatars — so it reaches
 * storage, and storage reaches `node:fs`. One value import of `REACTIONS`
 * from there pulled the whole server module into the browser bundle and the
 * build failed with "the chunking context does not support external modules".
 *
 * A closed set offered by the interface, not enforced by the column — see the
 * schema note. Six, because a row of reaction pills is a row and not a
 * keyboard: the point is to say something in one tap, and a picker with two
 * hundred faces in it is a second decision to make about a photograph of a
 * dinner.
 */
export const REACTIONS = ['❤️', '😂', '🔥', '👏', '😮', '🙏'] as const;
export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value);
}
