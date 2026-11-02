/**
 * The profile's shelf of rolls, and "Organize Rolls".
 *
 * `RollTile` is one tile as the shelf has always drawn it. `OrganizeShelf` is
 * the same tiles while somebody arranges them: each breathes on a cadence of
 * its own, so the shelf reads as loose and movable rather than as a grid that
 * froze, and a tile picked up follows the finger while the others make room.
 * Done, on the profile's corner, is what keeps the order.
 *
 * Plain `Animated` and a `PanResponder` per tile — the app has neither
 * Reanimated nor a gesture library, and adding one is a native build. The
 * motion is the design's: breath depth, cadences and stagger as handed off,
 * and 420ms on a (.2,.8,.2,1) curve for a tile settling into a slot.
 */

import { dateLabel } from '@parea/cards';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { EventListing } from './api';
import { moveTo, slotAt } from './shelfGrid';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';

/** The tile's picture. The name and date sit under it. */
export const TILE_H = 150;

/** One roll on the shelf: its cover, its name, and when and how many. */
export function RollTile({ event, t }: { event: EventListing; t: GroupTheme }) {
  /* When the album was made, which is what the card on the home screen
     already leads with — see the note where the shelf is drawn. */
  const when = dateLabel(event.createdAt);
  return (
    <>
      {event.cover ? (
        <Image source={{ uri: event.cover.src }} style={styles.tile} contentFit="cover" transition={120} />
      ) : (
        /*
          An album with nothing in it yet still belongs on the shelf. Dashed,
          which reads as "nothing here" rather than as a very dark photograph.
        */
        <View style={[styles.tile, styles.tileEmpty, { borderColor: t.line }]} />
      )}
      <Text style={[styles.tileName, { color: t.fg }]} numberOfLines={1}>
        {event.name}
      </Text>
      {/* A private album wears the padlock its home card does, in front. */}
      <View style={styles.tileMetaRow}>
        {event.accessPolicy === 'private' && (
          <View style={styles.tileLock}>
            <Glyph name="locked" size={11} weight={2.4} color={t.dim} />
          </View>
        )}
        <Text style={[styles.tileMeta, { color: t.dim, flexShrink: 1 }]} numberOfLines={1}>
          {event.photoCount === 0
            ? 'Nothing in it yet'
            : when
              ? `${when} · ${event.photoCount}`
              : `${event.photoCount} ${event.photoCount === 1 ? 'photo' : 'photos'}`}
        </Text>
      </View>
    </>
  );
}

// --- organizing ----------------------------------------------------------------

/*
 * Each tile's breath: seconds per breath, depth, and where in it the tile
 * starts. Hand-set so no two neighbours match, as the design has them; a
 * shelf longer than eight takes them round again.
 */
const DUR = [3.6, 4.4, 3.1, 4.9, 3.9, 2.9, 4.6, 3.4];
const DEPTH = [1, 0.8, 1.15, 0.9, 1.05, 0.85, 1.2, 0.95];
const STAGGER = [0, 380, 140, 620, 260, 820, 480, 700];
/** How far a breath swells, as a fraction of the tile. */
const BREATH = 0.025;
const SETTLE = { duration: 420, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };

/**
 * The shelf while it is being arranged.
 *
 * Every tile is placed absolutely at its slot, so a change of order is each
 * tile gliding to a new place rather than the grid reflowing under the finger.
 * `onOrder` hears every change, and the caller keeps the last one for Done.
 * `onDragging` is for the scroll view around this, which must stand still
 * while a tile is held — otherwise the drag scrolls the page instead.
 */
export function OrganizeShelf({
  events,
  tile,
  gap,
  t,
  onOrder,
  onDragging,
}: {
  events: EventListing[];
  tile: number;
  gap: number;
  t: GroupTheme;
  onOrder: (ids: string[]) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const [order, setOrder] = useState(() => events.map((event) => event.id));
  /** A tile's full height, name and date included — measured, then the row is that plus the gap. */
  const [tileH, setTileH] = useState(TILE_H + 38);
  const slotW = tile + gap;
  const rowH = tileH + gap;
  const at = (index: number) => ({ x: (index % 2) * slotW, y: Math.floor(index / 2) * rowH });

  // The latest of everything, for the responders, which are made once per tile.
  const live = useRef({ order, slotW, rowH });
  live.current = { order, slotW, rowH };

  const reorder = (id: string, x: number, y: number) => {
    const { order: now, slotW: w, rowH: h } = live.current;
    const to = slotAt(x, y, w, h, now.length);
    if (now.indexOf(id) === to) return;
    const next = moveTo(now, id, to);
    live.current.order = next;
    setOrder(next);
    onOrder(next);
  };

  const rows = Math.ceil(order.length / 2);
  return (
    <View style={{ height: rows * rowH - gap }}>
      {order.map((id, index) => {
        const event = byId.get(id);
        if (!event) return null;
        return (
          <OrganizeTile
            key={id}
            id={id}
            seed={events.indexOf(event)}
            slot={at(index)}
            tile={tile}
            t={t}
            event={event}
            onMeasure={index === 0 ? (e) => setTileH(e.nativeEvent.layout.height) : undefined}
            onMove={reorder}
            onDragging={onDragging}
            slotOf={() => at(live.current.order.indexOf(id))}
          />
        );
      })}
    </View>
  );
}

function OrganizeTile({
  id,
  seed,
  slot,
  tile,
  t,
  event,
  onMeasure,
  onMove,
  onDragging,
  slotOf,
}: {
  id: string;
  /** Which breath this tile takes, fixed for the session so reordering does not change it. */
  seed: number;
  slot: { x: number; y: number };
  tile: number;
  t: GroupTheme;
  event: EventListing;
  onMeasure?: (e: LayoutChangeEvent) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDragging: (dragging: boolean) => void;
  slotOf: () => { x: number; y: number };
}) {
  const place = useRef(new Animated.ValueXY(slot)).current;
  const lift = useRef(new Animated.Value(1)).current;
  const breath = useRef(new Animated.Value(1)).current;
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);

  /* Into its slot whenever the order moves it — unless it is the one in hand,
     which goes where the finger is. */
  useEffect(() => {
    if (heldRef.current) return;
    Animated.timing(place, { toValue: slot, ...SETTLE, useNativeDriver: true }).start();
  }, [place, slot.x, slot.y]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The breath: up, back, a small dip, back — on this tile's own cadence. */
  const loop = useRef<Animated.CompositeAnimation | null>(null);
  const breathe = (first: boolean) => {
    const k = seed % DUR.length;
    const d = DUR[k]! * 1000;
    const a = BREATH * DEPTH[k]!;
    const step = (toValue: number, share: number) =>
      Animated.timing(breath, {
        toValue,
        duration: d * share,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });
    loop.current = Animated.loop(
      Animated.sequence([step(1 + a, 0.45), step(1, 0.35), step(1 - a * 0.35, 0.1), step(1, 0.1)]),
    );
    const start = () => loop.current?.start();
    if (first) setTimeout(start, STAGGER[k]);
    else start();
  };
  useEffect(() => {
    breathe(true);
    return () => loop.current?.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const origin = useRef({ x: 0, y: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Once a tile is in hand, the page does not get it back mid-drag.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          heldRef.current = true;
          setHeld(true);
          onDragging(true);
          origin.current = slotOf();
          place.stopAnimation();
          place.setValue(origin.current);
          loop.current?.stop();
          Animated.parallel([
            Animated.timing(breath, { toValue: 1, duration: 160, useNativeDriver: true }),
            Animated.timing(lift, { toValue: 1.06, duration: 160, useNativeDriver: true }),
          ]).start();
        },
        onPanResponderMove: (_, g) => {
          const x = origin.current.x + g.dx;
          const y = origin.current.y + g.dy;
          place.setValue({ x, y });
          onMove(id, x, y);
        },
        onPanResponderRelease: () => drop(),
        onPanResponderTerminate: () => drop(),
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const drop = () => {
    heldRef.current = false;
    setHeld(false);
    onDragging(false);
    Animated.parallel([
      Animated.timing(place, { toValue: slotOf(), ...SETTLE, useNativeDriver: true }),
      Animated.timing(lift, { toValue: 1, ...SETTLE, useNativeDriver: true }),
    ]).start();
    breathe(false);
  };

  return (
    <Animated.View
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={`${event.name}. Drag to move it on your shelf.`}
      style={[
        styles.organizeTile,
        {
          width: tile,
          zIndex: held ? 40 : 1,
          transform: [{ translateX: place.x }, { translateY: place.y }, { scale: lift }],
        },
        held && styles.lifted,
      ]}
    >
      <Animated.View onLayout={onMeasure} style={{ transform: [{ scale: breath }] }}>
        <RollTile event={event} t={t} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: { width: '100%', height: 150, borderRadius: 12, backgroundColor: '#8881' },
  tileEmpty: { borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
  /* Under the picture rather than over it — see the shelf in `Profile.tsx`. */
  tileName: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  tileMeta: { fontSize: 12.5 },
  tileMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Up 1pt onto the line's cap height; never the thing that gives way.
  tileLock: { marginTop: -1, flexShrink: 0 },
  organizeTile: { position: 'absolute', left: 0, top: 0 },
  /* The tile in hand sits above the shelf, the way the design's shadow has it. */
  lifted: {
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 22 },
  },
});
