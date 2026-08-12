/**
 * Reading source in order to make assertions about it.
 *
 * Several tests here scan the app's own files for patterns — an S3 import in a
 * route, a raw `<img>`, a hand-rolled MIME list. All of them need comments
 * gone first, because comments in this codebase quote the very anti-patterns
 * being scanned for: the Storage interface's header contains `r2.get(key).body`
 * as the thing not to do, and a scan of raw source would flag the warning
 * against the mistake as the mistake.
 *
 * ## Why this is a scanner and not a regex
 *
 * It was a regex, twice, in two files that each had their own copy:
 *
 *     source.replace(/\/*[\s\S]*?\*​/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
 *
 * That is wrong in a way that makes tests pass. A block-comment opener is two
 * characters that occur inside perfectly ordinary strings — a file-input
 * `accept` of `image/` plus a star, a universal-link path pattern of `/e/`
 * plus a star — and the regex has no idea it is inside a string. It opens a
 * comment there and deletes everything up to the next real `*​/`, which can be
 * most of the file. The scan then reports nothing wrong about code it never
 * saw.
 *
 * That is not hypothetical: a guard written against exactly this deleted the
 * attribute it existed to check, and passed against a deliberately broken
 * version of it. The `[^:]` in the second half is the same bug already
 * noticed once and patched over — it is there so `https://` is not read as a
 * line comment.
 *
 * So this tracks string state, which is the only way to know whether `/*` is a
 * comment. It also keeps strings in the output rather than blanking them: the
 * things being scanned for are sometimes real code inside a template literal,
 * and removing string contents would hide those instead.
 *
 * Known limit: regular-expression literals are not parsed, so a regex
 * containing an escaped slash immediately followed by a star would still open
 * a comment. No file here has one, and the failure would be visible — a test
 * suddenly seeing less of a file — rather than a permanent blind spot.
 */

type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';

export function stripComments(source: string): string {
  let out = '';
  let state: State = 'code';
  let i = 0;

  while (i < source.length) {
    const char = source[i]!;
    const pair = source.slice(i, i + 2);

    if (state === 'code') {
      if (pair === '//') {
        state = 'line';
        i += 2;
      } else if (pair === '/*') {
        state = 'block';
        i += 2;
      } else {
        if (char === "'") state = 'single';
        else if (char === '"') state = 'double';
        else if (char === '`') state = 'template';
        out += char;
        i += 1;
      }
      continue;
    }

    if (state === 'line') {
      // The newline survives, so line numbers and `^`-anchored patterns in
      // callers still mean what they meant.
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (pair === '*/') {
        state = 'code';
        i += 2;
      } else {
        // Newlines are kept for the same reason as above.
        if (char === '\n') out += char;
        i += 1;
      }
      continue;
    }

    // Inside a string. Nothing here can open or close a comment.
    if (char === '\\') {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (
      (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      state = 'code';
    }
    out += char;
    i += 1;
  }

  return out;
}
