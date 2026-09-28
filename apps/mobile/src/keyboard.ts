/**
 * Whether the keyboard is up, for the two boxes that are pinned above it.
 *
 * A composer at the foot of a screen owes the home indicator a strip of room —
 * 30 points under the album's and the group's, 28 under the photograph's — and
 * that is right for as long as the bottom of the screen is the bottom of the
 * screen. It stops being right the moment a keyboard is there: the keys cover
 * the indicator completely, and `KeyboardAvoidingView` lifts the pane by the
 * keyboard's *whole* height, so the allowance for hardware that is no longer
 * visible becomes a band of empty page between the box somebody is typing in
 * and the keys they are typing on. The box reads as floating, and on a short
 * phone it is the last thing said in the room pushed off the top.
 *
 * So the strip is a question rather than a number, and this is the question.
 * `KeyboardAvoidingView` knows the answer already and keeps it to itself —
 * there is no way to read its state and no callback — which is why this is a
 * second subscription rather than something threaded out of the one component
 * that is doing the lifting.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardUp(): boolean {
  /*
   * Asked once at mount rather than assumed false. A sheet that opens with
   * `autoFocus` on its field — the photograph's comment box does — can be
   * mounted with the keyboard already on its way up, and starting at false
   * there means one frame drawn with the full strip and a visible jump.
   */
  const [up, setUp] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    /*
     * `will` on iOS, so the strip closes inside the keyboard's own animation
     * and the two move as one thing; Android only ever emits `did`, and the
     * frame it arrives on is the frame the resize lands on anyway.
     */
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setUp(true),
    );
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setUp(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return up;
}
