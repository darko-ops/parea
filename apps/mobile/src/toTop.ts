import { useEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';

/**
 * A tab's list, sent to its top when the tab is pressed while it is showing.
 *
 * The convention every phone app keeps: the tab you are on takes you to the top
 * of it. `top` is a counter `App` bumps on that press — a counter rather than a
 * flag, because pressing twice has to scroll twice — and zero is the value
 * nobody pressed with, so a tab arriving on screen does not jump.
 */
export function useToTop(top: number) {
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (top > 0) scroller.current?.scrollTo({ y: 0, animated: true });
  }, [top]);
  return scroller;
}
