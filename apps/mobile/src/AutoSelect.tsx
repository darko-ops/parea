/**
 * The auto-selection screen — docs/design.md §7.1–7.3.
 *
 * Opens on what it thinks are your photos from the event, already ticked, so
 * contributing is one tap instead of fifteen minutes of scrolling. That is the
 * thing the whole native client exists for.
 *
 * Two behaviours here matter more than the layout.
 *
 * When confidence is low the screen still appears and *nothing is ticked*.
 * Degrading to "here is a useful grid of the right time range, you pick" is a
 * good outcome. Degrading to forty-seven pre-ticked photos, three of which you
 * would be mortified to send, is the outcome that kills the feature — it
 * spends the contributor's trust and the photo-library permission in the same
 * moment, and neither comes back.
 *
 * And "Show everything from this window" is always available, which is what
 * makes a tight default safe rather than annoying: a missed photo costs one
 * tap, a wrong photo costs everything.
 */

import { describe as describeSuggestion, narrow, type Suggestion, type Window } from '@parea/autoselect';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { scanWindow, type LibraryScan } from './library';
import { Waiting } from './Waiting';

export type AutoSelectTheme = {
  bg: string;
  card: string;
  line: string;
  fg: string;
  dim: string;
  accent: string;
  onAccent: string;
};

export function AutoSelect({
  window,
  theme: t,
  onCancel,
  onConfirm,
  onShown,
}: {
  window: Window;
  theme: AutoSelectTheme;
  onCancel: () => void;
  /** Receives the final selection, and what was ticked when the screen opened. */
  onConfirm: (assetIds: string[], preselected: string[]) => void;
  /** §18's precision numerator and denominator, once the scan has run. */
  onShown?: (preselected: number, candidates: number) => void;
}) {
  const [scan, setScan] = useState<LibraryScan | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await scanWindow(window);
      const next = narrow(result.candidates, window);
      setScan(result);
      setSuggestion(next);
      setSelected(new Set(next.preselected));
      onShown?.(next.preselected.length, next.candidates.length);
    })();
    // `onShown` deliberately out of the deps: it is a fire-and-forget report,
    // and re-running the scan because a parent re-rendered would be a real
    // cost paid for a duplicate metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * By default the grid shows only what was suggested when confident, so the
   * screen is not a wall of things you have to reject. "Show everything"
   * widens it, which is the recall escape hatch.
   */
  const visible = useMemo(() => {
    if (!suggestion) return [];
    if (showAll || suggestion.confidence === 'low') return suggestion.candidates;
    const inCluster = new Set(suggestion.preselected);
    return suggestion.candidates.filter((c) => inCluster.has(c.id) || selected.has(c.id));
  }, [suggestion, showAll, selected]);

  if (!suggestion || !scan) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Waiting size={40} />
        <Text style={[styles.body, { color: t.dim }]}>Looking through your photos…</Text>
      </View>
    );
  }

  const hidden = suggestion.candidates.length - visible.length;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.h1, { color: t.fg }]}>
              {describeSuggestion(suggestion)}
            </Text>

            {suggestion.confidence === 'low' && suggestion.candidates.length > 0 && (
              <Text style={[styles.body, { color: t.dim }]}>
                Nothing is selected — we could not tell which of these were from
                the event, so this is your call rather than ours.
              </Text>
            )}

            {scan.locationErrors > 0 && (
              // "Could not look", never "no GPS" — see library.ts.
              <Text style={[styles.body, { color: t.dim }]}>
                Could not read location for {scan.locationErrors} of these, so
                they are not selected automatically.
              </Text>
            )}

            {scan.truncated && (
              <Text style={[styles.body, { color: t.dim }]}>
                There were more photos in this time range than we looked at.
              </Text>
            )}

            {suggestion.screenshotsExcluded > 0 && (
              <Text style={[styles.body, { color: t.dim }]}>
                {suggestion.screenshotsExcluded} screenshot
                {suggestion.screenshotsExcluded === 1 ? '' : 's'} left out.
              </Text>
            )}

            {hidden > 0 && !showAll && (
              <Pressable onPress={() => setShowAll(true)}>
                <Text style={[styles.body, { color: t.accent }]}>
                  Show everything from this window ({hidden} more)
                </Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.body, { color: t.dim, padding: 20 }]}>
            Nothing from this time on this phone.
          </Text>
        }
        renderItem={({ item }) => {
          const isOn = selected.has(item.id);
          return (
            <Pressable style={styles.tile} onPress={() => toggle(item.id)}>
              <Image
                source={{ uri: `ph://${item.id}` }}
                style={[styles.thumb, { opacity: isOn ? 1 : 0.45 }]}
                contentFit="cover"
              />
              <View
                style={[
                  styles.check,
                  {
                    backgroundColor: isOn ? t.accent : 'transparent',
                    borderColor: isOn ? t.accent : '#fff',
                  },
                ]}
              >
                {isOn && <Text style={styles.tick}>✓</Text>}
              </View>
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { backgroundColor: t.card, borderTopColor: t.line }]}>
        <Pressable onPress={onCancel} style={styles.footerButton}>
          <Text style={[styles.buttonText, { color: t.fg }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onConfirm([...selected], suggestion.preselected)}
          disabled={selected.size === 0}
          style={[
            styles.footerButton,
            { backgroundColor: t.accent, opacity: selected.size === 0 ? 0.5 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            {selected.size === 0
              ? 'Nothing selected'
              : `Add ${selected.size} ${selected.size === 1 ? 'photo' : 'photos'}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  grid: { padding: 9, paddingTop: 64, paddingBottom: 20 },
  header: { gap: 8, paddingHorizontal: 3, paddingBottom: 14 },
  h1: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  tile: { flex: 1 / 3, padding: 3 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 6, backgroundColor: '#8883' },
  check: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { color: '#fff', fontSize: 14, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    paddingBottom: 34,
    borderTopWidth: 1,
  },
  footerButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
