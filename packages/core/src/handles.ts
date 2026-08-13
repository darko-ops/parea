/**
 * Handles — the one name in this product that is unique.
 *
 * `display_name` is what people see beside your photos and is deliberately not
 * unique: two people called Sam at the same party are two people called Sam. A
 * handle is the other thing — one per person, typed rather than chosen from a
 * list, and stable enough to be worth remembering.
 *
 * Pure and shared, because both clients validate before sending and the server
 * validates again before writing, and three implementations of "what is a legal
 * handle" is three answers to that question.
 */

/** Long enough for a name and a surname, short enough to fit beside a photo. */
export const HANDLE_MAX = 30;
export const HANDLE_MIN = 2;

/**
 * Words a handle may not be.
 *
 * Every one of these is either a path this product already serves or a word
 * that would let someone be mistaken for it. The first group matters because a
 * handle is the sort of thing that ends up in a URL eventually, and the day
 * that happens `/settings` must not be a person. The second matters
 * immediately: an account called `parea` or `support` can ask for things in a
 * way a stranger's account cannot.
 */
export const RESERVED_HANDLES: readonly string[] = [
  'account', 'accounts', 'admin', 'administrator', 'api', 'auth',
  'event', 'events', 'find', 'group', 'groups', 'help', 'home',
  'login', 'logout', 'me', 'moderator', 'new', 'parea', 'photo', 'photos',
  'privacy', 'root', 'safety', 'security', 'settings', 'signin', 'signup',
  'staff', 'support', 'system', 'terms', 'user', 'users', 'you',
];

/**
 * What we store, given what someone typed.
 *
 * Case-folded here rather than compared case-insensitively at every call site.
 * Nobody remembers whether they capitalised their own handle, and `Sam` and
 * `sam` resolving to two accounts is a way to be impersonated rather than a
 * way to be distinct.
 */
export function normaliseHandle(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Why this handle is not allowed, or null if it is.
 *
 * Returns a sentence rather than a code. There is exactly one screen that
 * shows these and it shows them verbatim; a code would mean a second table
 * mapping codes to the same sentences, kept in step by hand.
 */
export function handleProblem(input: string): string | null {
  const handle = normaliseHandle(input);

  if (handle.length < HANDLE_MIN) {
    return `Handles are at least ${HANDLE_MIN} characters.`;
  }
  if (handle.length > HANDLE_MAX) {
    return `Handles are at most ${HANDLE_MAX} characters.`;
  }
  if (!/^[a-z0-9._]+$/.test(handle)) {
    // Named rather than described. "Invalid characters" makes someone hunt
    // through their own typing for which one.
    return 'Letters, numbers, underscores and full stops only — no spaces.';
  }
  if (!/^[a-z0-9]/.test(handle) || !/[a-z0-9]$/.test(handle)) {
    // A leading dot hides a handle in some listings and a trailing one reads
    // as the end of a sentence.
    return 'Handles start and end with a letter or a number.';
  }
  if (/[._]{2}/.test(handle)) {
    return 'No two dots or underscores in a row.';
  }
  if (RESERVED_HANDLES.includes(handle)) {
    return 'That one is reserved.';
  }
  return null;
}
