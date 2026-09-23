/**
 * Signing in on the phone, and the two ways it used to end in silence.
 *
 * The card itself was never the problem. What it sits in was.
 *
 * A `ScrollView` defaults to `keyboardShouldPersistTaps="never"`, which means
 * that while a field has focus the first tap anywhere else is spent dismissing
 * the keyboard and the child never sees it. Every other form in the app got
 * away with it, because every other form is typed into on a keyboard with a
 * return key and people put it away before pressing anything. The code field
 * opens the number pad, which has none — so "Sign in" was the only thing left
 * to press, and pressing it did nothing at all. The mail arrived, the code was
 * right, and the button was dead: exactly the shape of the report.
 *
 * The other half is the sheets. A sheet is pinned to the bottom edge and iOS
 * does not move a transparent modal for the keyboard, so on both of the places
 * that ask for an account over something else the button was behind it.
 *
 * And what happens after: `completeSignIn` sets the token on the `Api` object,
 * which lasts exactly as long as the launch. Without the keychain write, an
 * account made on a new phone was gone by the next cold start.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const EVENTS = read('src/Events.tsx');
const PROFILE = read('src/Profile.tsx');

/** The card, on its own. Everything below is about what holds it. */
const CARD = EVENTS.slice(
  EVENTS.indexOf('export function AccountCard'),
  EVENTS.indexOf('type ButtonComponent'),
);

/**
 * The scrollers and sheets a `<AccountCard` is actually inside, innermost
 * last, as opening tags.
 *
 * Walked rather than listed. A fifth place to sign in would otherwise be a
 * fifth place for the button to be dead with this test still green — and
 * `lastIndexOf` is not the same question, because it finds the previous
 * scroller in the file as readily as the enclosing one.
 */
function ancestors(source: string, at: number): string[] {
  const stack: string[] = [];
  // The lookahead skips `useRef<ScrollView | null>`, which is a type and not
  // a thing anything is inside.
  const tag = /<(\/?)(ScrollView|Modal|KeyboardAvoidingView)(?!\s*\|)[\s>]/g;
  for (const m of source.slice(0, at).matchAll(tag)) {
    if (m[1]) stack.pop();
    else stack.push(source.slice(m.index, source.indexOf('>', m.index) + 1));
  }
  return stack;
}

/** Each `<AccountCard` in a file, as the list of things wrapping it. */
function cards(source: string): string[][] {
  const found: string[][] = [];
  let at = source.indexOf('<AccountCard');
  while (at !== -1) {
    found.push(ancestors(source, at));
    at = source.indexOf('<AccountCard', at + 1);
  }
  return found;
}

const CARDS = [...cards(APP), ...cards(PROFILE)];

describe('the taps reach the button', () => {
  it('has a card to sign in with in four places, and no others', () => {
    // The count is the point: it is what makes the loops below exhaustive.
    expect(cards(APP)).toHaveLength(2);
    expect(cards(PROFILE)).toHaveLength(2);
    // And every one of them is inside something that scrolls or slides up.
    for (const wrappers of CARDS) expect(wrappers.length).toBeGreaterThan(0);
  });

  it('persists taps on every scroller holding one', () => {
    for (const wrappers of CARDS) {
      for (const tag of wrappers.filter((w) => w.startsWith('<ScrollView'))) {
        expect(tag).toMatch(/keyboardShouldPersistTaps=\{?["']handled["']\}?/);
      }
    }
  });

  it('lifts every sheet holding one clear of the keyboard', () => {
    for (const wrappers of CARDS) {
      if (!wrappers.some((w) => w.startsWith('<Modal'))) continue;
      // Inside the modal rather than around it: a wrapper further out is the
      // size of the screen and moves nothing.
      const modal = wrappers.findIndex((w) => w.startsWith('<Modal'));
      expect(
        wrappers.slice(modal).some((w) => w.startsWith('<KeyboardAvoidingView')),
      ).toBe(true);
    }
  });

  it('pads on iOS only', () => {
    /*
     * Android resizes the window itself. Padding on top of that lifts a sheet
     * into the middle of the screen, which looks like a bug rather than a
     * keyboard.
     */
    for (const source of [APP, PROFILE]) {
      const uses = source.split('<KeyboardAvoidingView').slice(1);
      for (const use of uses) {
        expect(use.slice(0, use.indexOf('>'))).toMatch(
          /behavior=\{(RN)?Platform\.OS === 'ios' \? 'padding' : undefined\}/,
        );
      }
    }
  });
});

describe('the account outlives the launch', () => {
  it('writes the token to the keychain, not just to the client', () => {
    /*
     * `api.completeSignIn` sets it in memory — see `api.ts`, which stays free
     * of anything device-shaped — so the write belongs at this call site.
     */
    expect(CARD).toMatch(
      /completeSignIn\([\s\S]{0,900}?saveActorToken\(result\.actorToken\)/,
    );
    expect(EVENTS).toMatch(/import \{[^}]*saveActorToken[^}]*\} from '\.\/platform'/);
  });

  it('writes it before the screen says it worked', () => {
    // Otherwise a failed write is a screen that says "Signed in" over a phone
    // that is not, and nothing asks again until the next cold start.
    const write = CARD.indexOf('saveActorToken(');
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(CARD.indexOf('onSignedIn();'));
  });

  it('keeps the keychain out of the api client', () => {
    // The one rule that makes `api.ts` testable without a device.
    expect(read('src/api.ts')).not.toMatch(/expo-secure-store|saveActorToken/);
  });
});

describe('the card still says what it always said', () => {
  it('will not send a code that is not six digits', () => {
    expect(CARD).toMatch(/disabled=\{busy \|\| \(sent \? code\.length < 6 : !email\.includes\('@'\)\)\}/);
  });

  it('opens the number pad and offers the code from the notification', () => {
    expect(CARD).toMatch(/keyboardType="number-pad"/);
    expect(CARD).toMatch(/textContentType="oneTimeCode"/);
  });
});
