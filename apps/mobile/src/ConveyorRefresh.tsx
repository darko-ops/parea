/**
 * Pull to refresh, as three dots on a conveyor — handoff 7a.
 *
 * The system spinner said "loading" in the operating system's voice on the two
 * tabs people pull most. This says it in the app's: three dots pop in left to
 * right as the list comes down, then bob across the gap it opened and wrap
 * round until the refresh lands, and fade as the list settles back. Each pull
 * takes one of five palettes, never the one before.
 *
 * ## How the list is held open
 *
 * iOS only, because only iOS overscrolls: the pull is the scroll view's own
 * rubber band, read off `contentOffset.y`. Releasing past the trigger sets
 * `contentInset.top` to the rest height — which is where the bounce now comes
 * back to — and the inset going to zero, with a scroll to the top, is the
 * return. Android has no pull past the top to read, so it keeps the system
 * `RefreshControl`, which is what a pull there already looks like.
 *
 * ## Why the dots are not in the list
 *
 * Drawn behind it, in the gap the content leaves as it comes down, so nothing
 * in the list moves to make room and the head is not pushed around by a
 * spinner. Their state lives in a store this module owns rather than in the
 * tab, so a frame of motion re-renders three dots and not a screen of cards.
 *
 * No haptic at the trigger, which the handoff asks for: the app has no haptics
 * module, and adding one is a native build. The dots all being out is the
 * sign the pull will take.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Platform,
  RefreshControl,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

import {
  LIGHT_PALETTES,
  PALETTES,
  SPEC,
  nextPalette,
  pullingDots,
  travellingDots,
  type Dot,
} from './conveyor';

export { isDarkPage } from './conveyor';

// --- the state, outside React's render ---------------------------------------

type Phase = 'idle' | 'pulling' | 'loading' | 'resolving';

type Frame = { dots: Dot[]; colours: [string, string, string] };

const NOTHING: Frame = { dots: [], colours: PALETTES[0]! };

/**
 * A pull's whole life, and the one thing the dots read.
 *
 * Mutated by scroll events and a frame loop and announced to its listeners,
 * rather than kept in state: scroll events arrive sixty times a second, and a
 * state change there re-renders the tab and every card in it.
 */
class Conveyor {
  phase: Phase = 'idle';
  pull = 0;
  /** Finger on the list. Only a drag starts a pull: the list springing back does not. */
  dragging = false;
  palette = 0;
  prev: number | null = null;
  loadStart = 0;
  resolveStart = 0;
  width = 390;
  allowed = [0, 1, 2, 3, 4];
  frame: Frame = NOTHING;
  private listeners = new Set<() => void>();
  private raf: number | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.frame;

  private draw() {
    const now = Date.now();
    const colours = PALETTES[this.palette]!;
    let dots: Dot[] = [];
    if (this.phase === 'pulling') dots = pullingDots(this.pull);
    else if (this.phase === 'loading') {
      dots = travellingDots(now - this.loadStart, this.pull, this.width);
    } else if (this.phase === 'resolving') {
      const q = (now - this.resolveStart) / SPEC.returnMs;
      if (q >= 1) {
        this.phase = 'idle';
        dots = [];
      } else {
        dots = travellingDots(now - this.loadStart, this.pull, this.width, q);
      }
    }
    this.frame = { dots, colours };
    for (const listener of this.listeners) listener();
  }

  private loop = () => {
    this.draw();
    this.raf =
      this.phase === 'loading' || this.phase === 'resolving'
        ? requestAnimationFrame(this.loop)
        : null;
  };

  begin() {
    this.dragging = true;
  }

  scrolled(offsetY: number) {
    this.pull = Math.max(0, -offsetY);
    if (this.phase === 'idle' && this.pull > 0 && this.dragging) {
      // This pull's palette, held through the load and the return.
      this.phase = 'pulling';
      this.palette = nextPalette(this.prev, this.allowed);
      this.prev = this.palette;
    }
    if (this.phase === 'pulling') {
      if (this.pull === 0) this.phase = 'idle';
      this.draw();
    }
  }

  /** Whether letting go here starts a refresh. */
  release(): boolean {
    this.dragging = false;
    if (this.phase !== 'pulling' || this.pull < SPEC.triggerPull) return false;
    this.phase = 'loading';
    this.loadStart = Date.now();
    if (this.raf === null) this.loop();
    return true;
  }

  resolve() {
    if (this.phase !== 'loading') return;
    this.phase = 'resolving';
    this.resolveStart = Date.now();
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}

// --- the hook ------------------------------------------------------------------

/**
 * Everything a tab needs: the props for its `ScrollView`, and the dots to draw
 * behind it.
 *
 * `onRefresh` is whatever the tab already did on a pull. The list is held open
 * for at least `minLoadingMs` either way, so a refresh that answers from cache
 * still reads as one.
 */
export function useConveyorRefresh({
  onRefresh,
  scroller,
  dark,
  width,
  tint,
}: {
  onRefresh: () => Promise<unknown>;
  scroller: React.RefObject<ScrollView | null>;
  dark: boolean;
  width: number;
  /** The system spinner's colour, on Android. */
  tint: string;
}) {
  const conveyor = useMemo(() => new Conveyor(), []);
  conveyor.width = width;
  conveyor.allowed = dark ? [0, 1, 2, 3, 4] : LIGHT_PALETTES;
  useEffect(() => () => conveyor.stop(), [conveyor]);

  const [holding, setHolding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const offset = useRef(0);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  const run = useCallback(async () => {
    const started = Date.now();
    try {
      await refresh.current();
    } catch {
      // The tab's own refresh says what went wrong, if anything; the dots
      // only ever said "working".
    }
    const left = SPEC.minLoadingMs - (Date.now() - started);
    if (left > 0) await new Promise((done) => setTimeout(done, left));
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      conveyor.scrolled(offset.current);
    },
    [conveyor],
  );

  const onScrollBeginDrag = useCallback(() => conveyor.begin(), [conveyor]);

  const onScrollEndDrag = useCallback(() => {
    if (!conveyor.release()) return;
    setHolding(true);
    scroller.current?.scrollTo({ y: -SPEC.restPull, animated: true });
    void (async () => {
      await run();
      conveyor.resolve();
      setHolding(false);
      // Only if the list is still pulled down: somebody who scrolled into it
      // while it loaded is not sent back to the top.
      if (offset.current < 0) scroller.current?.scrollTo({ y: 0, animated: true });
    })();
  }, [conveyor, run, scroller]);

  const android = useCallback(async () => {
    setRefreshing(true);
    await run();
    setRefreshing(false);
  }, [run]);

  /*
   * `onScrollBeginDrag` on both, so a tab that has its own can call this one
   * from it without asking which platform it is on.
   */
  const scrollProps =
    Platform.OS === 'ios'
      ? {
          onScroll,
          onScrollBeginDrag,
          onScrollEndDrag,
          scrollEventThrottle: 16,
          contentInset: { top: holding ? SPEC.restPull : 0, left: 0, bottom: 0, right: 0 },
        }
      : {
          onScrollBeginDrag,
          refreshControl: <RefreshControl refreshing={refreshing} onRefresh={android} tintColor={tint} />,
        };

  return { scrollProps, conveyor };
}

/** The dots, behind the list. Draws nothing until a pull starts. */
export function ConveyorDots({ conveyor }: { conveyor: Conveyor }) {
  const frame = useSyncExternalStore(conveyor.subscribe, conveyor.snapshot);
  if (frame.dots.length === 0) return null;
  return (
    <View pointerEvents="none" style={styles.layer}>
      {frame.dots.map((dot, i) =>
        dot.r <= 0.05 ? null : (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: dot.x - dot.r,
              top: dot.y - dot.r,
              width: dot.r * 2,
              height: dot.r * 2,
              borderRadius: dot.r,
              opacity: dot.opacity,
              backgroundColor: frame.colours[i],
            }}
          />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },
});
