/**
 * Seconds since mount, a frame at a time — and whether to move at all.
 *
 * The two loading animations change the mark's *shape* every frame (circles
 * growing, spreading), which a native-driver transform cannot express: it is a
 * new path each time. So they redraw from a clock. It is one small SVG for a
 * few seconds, which a frame loop handles comfortably, and it stops the moment
 * the component goes.
 *
 * Under Reduce Motion the clock does not run and `still` is true; the callers
 * draw the settled mark instead.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useMotionClock(): { t: number; still: boolean } {
  const [t, setT] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (live) setStill(on);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);

  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = Date.now();
    const tick = () => {
      setT((Date.now() - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still]);

  return { t, still };
}
