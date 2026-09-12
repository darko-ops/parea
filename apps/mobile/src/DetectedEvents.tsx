/**
 * "Last night · 34 photos" — the offer that replaces the question.
 *
 * The create screen used to open on a radio list: Tonight, Last night, Today,
 * Yesterday, Not sure. It worked, and it asked the wrong party. The phone
 * already holds the answer with exact edges — a night out is a run of photos
 * with hours of nothing on either side — so this reads the last few days,
 * finds the runs, and shows them as things to tap.
 *
 * What that buys, beyond one fewer question:
 *
 *   - the window is accurate to the minute rather than to the nearest six
 *     hours, and it is stored on the event, so it is what *other people's*
 *     phones select against later;
 *   - nobody answers carelessly, because nobody answers. §17's worry was that
 *     a careless answer pre-ticks the wrong photos; an unanswered question
 *     cannot be answered carelessly;
 *   - the name field arrives with something in it.
 *
 * ## Permission stays where it was
 *
 * §7.4 puts the photo-library prompt at a moment of demonstrated value rather
 * than in front of everything. Detection needs the library, so this screen
 * shows the offer only when permission is already held, and otherwise shows a
 * button that says what it is about to do. It never asks on arrival, and the
 * manual path is always there — being unable to read the library makes this
 * screen worse, not broken.
 */

import { recentBundles, RECENT_DAYS, type Bundle } from '@parea/autoselect';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { libraryAccess, requestLibraryAccess, scanRecent } from './library';
import type { GroupTheme } from './Groups';
import { Waiting } from './Waiting';

type State =
  | { kind: 'checking' }
  /** Permission not held. Offer to ask; never ask on arrival. */
  | { kind: 'ask' }
  | { kind: 'scanning' }
  | { kind: 'found'; bundles: Bundle[]; limited: boolean }
  | { kind: 'none'; limited: boolean }
  /** Asked and refused, or refused long ago. The manual path is all there is. */
  | { kind: 'blocked' };

export function DetectedEvents({
  t,
  onPick,
  now,
}: {
  t: GroupTheme;
  /** The chosen run. The caller turns it into an event and opens the grid. */
  onPick: (bundle: Bundle) => void;
  /** Injected by tests; the device clock otherwise. */
  now?: Date;
}) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  // Depended on as a number, not a Date. The effect below re-runs whenever
  // `scan` changes, and a caller writing `now={new Date()}` inline would hand
  // it a fresh object every render — an unbounded loop of library scans, which
  // is an expensive way to fail.
  const at = now?.getTime();

  const scan = useCallback(
    async (limited: boolean) => {
      setState({ kind: 'scanning' });
      try {
        const { candidates } = await scanRecent(RECENT_DAYS, at);
        const bundles = recentBundles(candidates, {
          now: at === undefined ? undefined : new Date(at),
        });
        setState(
          bundles.length > 0
            ? { kind: 'found', bundles, limited }
            : { kind: 'none', limited },
        );
      } catch {
        // A library that cannot be read is not an error worth a dialog — it is
        // the same outcome as an empty one, and the manual path still works.
        setState({ kind: 'none', limited });
      }
    },
    [at],
  );

  useEffect(() => {
    (async () => {
      const access = await libraryAccess();
      if (access === 'granted' || access === 'limited') {
        await scan(access === 'limited');
      } else {
        setState({ kind: access === 'denied' ? 'blocked' : 'ask' });
      }
    })();
  }, [scan]);

  const ask = useCallback(async () => {
    const access = await requestLibraryAccess();
    if (access === 'granted' || access === 'limited') await scan(access === 'limited');
    else setState({ kind: 'blocked' });
  }, [scan]);

  if (state.kind === 'checking') return null;

  if (state.kind === 'blocked') return null;

  if (state.kind === 'ask') {
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Was it last night?</Text>
        <Text style={[styles.small, { color: t.dim }]}>
          If you let Parea look at your photos, it can find the ones you took
          together and start the event from them — so nobody has to scroll.
          Nothing is uploaded until you pick it.
        </Text>
        <Pressable
          onPress={ask}
          style={[styles.askButton, { backgroundColor: t.accent }]}
        >
          <Text style={[styles.askLabel, { color: t.onAccent }]}>Find my photos</Text>
        </Pressable>
      </View>
    );
  }

  if (state.kind === 'scanning') {
    return (
      <View style={[styles.card, styles.scanning, { backgroundColor: t.card, borderColor: t.line }]}>
        <Waiting size={26} />
        <Text style={[styles.small, { color: t.dim }]}>Looking at the last few days…</Text>
      </View>
    );
  }

  if (state.kind === 'none') {
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.small, { color: t.dim }]}>
          {state.limited
            ? 'Nothing recent in the photos you shared with Parea. Name it below and add photos yourself.'
            : 'No recent run of photos on this phone. Name it below — you can add photos any time.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={[styles.label, { color: t.fg }]}>Start from your photos</Text>
      {state.bundles.map((bundle) => (
        <Pressable
          key={bundle.coverId}
          onPress={() => onPick(bundle)}
          style={[styles.bundle, { backgroundColor: t.card, borderColor: t.line }]}
        >
          <Image
            source={{ uri: `ph://${bundle.coverId}` }}
            style={styles.cover}
            contentFit="cover"
          />
          <View style={styles.bundleText}>
            <Text style={[styles.bundleTitle, { color: t.fg }]}>{bundle.label}</Text>
            <Text style={[styles.small, { color: t.dim }]}>
              {bundle.count} {bundle.count === 1 ? 'photo' : 'photos'} · {bundle.timeRange}
            </Text>
            {/*
              Said on the card rather than discovered in the grid. The whole
              value of the offer is that it is trustworthy, and "34 photos"
              followed by an empty selection reads as a bug.
            */}
            {bundle.suggestion.confidence === 'low' && (
              <Text style={[styles.small, { color: t.dim }]}>
                You&rsquo;ll pick which ones — these were taken in more than one
                place.
              </Text>
            )}
          </View>
        </Pressable>
      ))}
      {state.limited && (
        <Text style={[styles.small, { color: t.dim }]}>
          Only looking at the photos you shared with Parea.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  scanning: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  askButton: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  askLabel: { fontSize: 15, fontWeight: '600' },
  bundle: {
    flexDirection: 'row',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
  },
  cover: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#8883' },
  bundleText: { flex: 1, gap: 2 },
  bundleTitle: { fontSize: 17, fontWeight: '700' },
});
