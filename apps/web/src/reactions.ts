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

/**
 * The longest a single emoji can legitimately be, in UTF-16 units.
 *
 * A family of four with skin tones is the worst realistic case and comes to
 * about twenty. The bound is not really about length — the grapheme check below
 * already does that work — it is a cheap first refusal so a megabyte of text
 * never reaches `Intl.Segmenter`.
 */
const LONGEST = 24;

/** `1️⃣`, `#️⃣` — a digit, an optional selector, and the enclosing keycap. */
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;

/** A flag: two regional indicators and nothing else. */
const FLAG = /^\p{Regional_Indicator}{2}$/u;

/**
 * Whether something is *an* emoji — one of them, not a message made of them.
 *
 * Photo reactions were the six in `REACTIONS` and the picker offered exactly
 * those, so `isReaction` was both the validation and the vocabulary. The app
 * lets somebody reach for the system keyboard now, which means the set is open
 * and the server has to say what an emoji is rather than which ones it likes.
 *
 * Three conditions, and the first two are what matter:
 *
 *   - **exactly one grapheme.** This is the rule that keeps a reaction a
 *     reaction. Without it the column under a photograph is a text channel with
 *     no length limit, no moderation and no report button, reached by typing
 *     into a box labelled "pick an emoji".
 *   - **no letters or digits**, so the one grapheme cannot be a word character
 *     wearing a variation selector.
 *   - **and it has to be a picture.** `Extended_Pictographic` is the Unicode
 *     property for that, and it is deliberately generous: `™` and `©` pass, and
 *     a reaction of `™` is a joke rather than a problem.
 *
 * Keycaps and flags are allowed explicitly because both would fail the second
 * condition — a keycap begins with a digit and a flag is two letters that are
 * not letters. Both are ordinary reactions on every other product.
 */
export function isEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > LONGEST) return false;

  // One grapheme, by the same rules a text renderer uses to decide what a
  // single character is. Counting code points instead would let a ZWJ sequence
  // of a dozen faces through as "many", and a plain `.length` is worse still.
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)];
  if (graphemes.length !== 1) return false;

  if (KEYCAP.test(value) || FLAG.test(value)) return true;
  if (/\p{L}|\p{N}/u.test(value)) return false;
  return /\p{Extended_Pictographic}/u.test(value);
}
