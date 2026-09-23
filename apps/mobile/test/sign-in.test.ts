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
  it('has a card to sign in with in five places, and no others', () => {
    // The count is the point: it is what makes the loops below exhaustive.
    // Three in `App.tsx` — the gate on the tabs, the gate on making an album,
    // and the sheet over adding photos — and two in the profile.
    expect(cards(APP)).toHaveLength(3);
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

describe('a refused attempt is not a refused code', () => {
  /*
   * Both routes answer 429 when this source has spent its allowance, and the
   * card used to fold that into the sentence for a wrong code. It is the one
   * refusal where "try again" is advice that cannot work, and the person is
   * usually holding a perfectly good code while being told it expired — so
   * they ask for another, spend more of the allowance, and are told the same
   * thing again. The server's own note calls the 429 the one answer here that
   * describes the caller rather than any address, which is what makes it safe
   * to repeat out loud.
   */
  it('says so when the code could not even be tried', () => {
    const verify = CARD.slice(CARD.indexOf('const verify'), CARD.indexOf('const signOut'));
    expect(verify).toMatch(/err instanceof ApiError && err\.code === 'too_many_requests'/);
    expect(verify).toMatch(/Wait an hour/);
    // And still says the old thing for a code that was simply wrong.
    expect(verify).toMatch(/That code did not work/);
  });

  it('says so when no more codes will be sent', () => {
    const request = CARD.slice(CARD.indexOf('const request'), CARD.indexOf('const verify'));
    expect(request).toMatch(/err instanceof ApiError && err\.code === 'too_many_requests'/);
    expect(request).toMatch(/Try again in an hour/);
  });

  it('warns that asking again is what stops the mail', () => {
    // The trap is silent on the server by design — a distinguishable "that
    // address has had enough" would answer the question the endpoint refuses
    // to answer — so the only place it can be said is in general, here.
    expect(CARD).toMatch(/Asking over and over\s+stops the mail for an hour/);
  });
});
