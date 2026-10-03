/**
 * The sign-in card is drawn inside other forms, and must never submit.
 *
 * The Create Roll page wraps it in its own `<form>`. A `<button>` with no type
 * is a submit button, so pressing Go on a phone's keyboard — or a browser
 * filling the code from Mail and submitting — "clicked" the first one in the
 * form: the Sign in tab, which put the card back to its email step. Somebody
 * typed their code and was left with only "Send me a code", and each press
 * sent another.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CARD = readFileSync(
  fileURLToPath(new URL('../app/components/SignIn.tsx', import.meta.url)),
  'utf8',
);

describe('the sign-in card inside somebody else’s form', () => {
  it('has no button that can submit', () => {
    const buttons = CARD.match(/<button\b[^>]*/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toContain('type="button"');
  });

  it('handles Enter in its fields itself, as the main button would', () => {
    expect(CARD.match(/onKeyDown=\{onEnter\}/g)).toHaveLength(2);
    expect(CARD).toMatch(/if \(e\.key !== 'Enter'\) return;\s*e\.preventDefault\(\);\s*submit\(\);/);
    expect(CARD).toMatch(/void \(stage === 'code' \? verify\(\) : request\(\)\);/);
  });
});
