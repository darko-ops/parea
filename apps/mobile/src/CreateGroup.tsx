/**
 * Making a group on the phone — the same two states as the web's card.
 *
 * ## Why a suggestion is safe here
 *
 * The Groups tab used to refuse a create action, and said so: a group is made
 * from an event, because noticing that the same people keep turning up happens
 * afterwards, and an empty group you then have to fill is a distribution
 * problem with no photographs in it.
 *
 * What reverses that is not a change of mind but what now sits beside the
 * button — the people this actor keeps ending up in the same events as. The
 * screen is not proposing anything it knows better than they do; it is showing
 * them something they already did and offering to name it. So the copy never
 * says they *have* groups, never counts clusters as though they were groups,
 * and never uses a second word for making a group with these people.
 *
 * ## Nothing is written until Create
 *
 * `Make a group` swaps the card for the form and does nothing else: no row, no
 * notification, no request. Removing somebody tells them nothing. Backing out
 * loses nothing, because there was nothing. That property is what makes
 * suggesting a set of people acceptable rather than presumptuous, and it is
 * worth stating plainly — **the only call in this file is behind Create**.
 *
 * ## The consent line goes above the button
 *
 * Creating from people writes memberships rather than invitations: everybody
 * listed already has the photographs from the events the cluster came from, so
 * asking them to accept a room they are effectively in is a formality that
 * arrives as a chore. That is still a real thing to do to somebody, so the
 * sentence saying it is above the button where it is read before the decision,
 * not in a confirmation afterwards.
 */

import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Api, Cluster, ClusterPerson } from './api';
import type { GroupTheme } from './Groups';

/** Chips shown before the rest collapse behind `+N more`. */
const CHIPS_SHOWN = 6;

function firstNameOf(name: string): string {
  return name.replace(/^@/, '').split(/\s+/)[0] || name;
}

function initialOf(name: string): string {
  return name.replace(/^@/, '').slice(0, 1).toUpperCase() || '?';
}

/**
 * A face, or the letter that stands in for one.
 *
 * The same fallback rule as `Face` on the web, and it matters more here: an
 * avatar URL is presigned for an hour, and a tab left open on a phone outlives
 * that easily. A broken-image glyph on a card whose whole job is to be
 * recognised would be worse than a letter.
 */
function FaceOf({
  person,
  size,
  t,
}: {
  person: { name: string; avatarUrl: string | null };
  size: number;
  t: GroupTheme;
}) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (!person.avatarUrl) {
    return (
      <View style={[shape, styles.faceFallback, { backgroundColor: t.line }]}>
        <Text style={{ color: t.dim, fontSize: size * 0.4, fontWeight: '600' }}>
          {initialOf(person.name)}
        </Text>
      </View>
    );
  }
  return (
    <Image source={{ uri: person.avatarUrl }} style={shape} contentFit="cover" transition={120} />
  );
}

/**
 * What the product noticed, as one line.
 *
 * This was a bordered card with a filled button on it, which on a tab full of
 * rooms somebody is actually in gave "these three people were at four of the
 * same evenings" the same weight as a group they had already made. It is a
 * remark about the list above it, so it is drawn as one: a rule, three
 * overlapping faces, a sentence and a verb — no box, no fill, and no claim on
 * the screen's primary action, which is opening a group.
 *
 * The wording keeps the rule the card had: the count, and never the name of an
 * event. The moment this line names one, the suggestion starts to look like it
 * was derived from that event rather than from the people, which is the
 * opposite of what it says.
 */
export function ClusterCard({
  cluster,
  onMake,
  t,
}: {
  cluster: Cluster;
  onMake: () => void;
  t: GroupTheme;
}) {
  return (
    <View style={[styles.suggestion, { borderTopColor: t.line }]}>
      <View style={styles.stack}>
        {cluster.faces.map((person, i) => (
          <View key={i} style={i === 0 ? undefined : styles.overlap}>
            <FaceOf person={person} size={26} t={t} />
          </View>
        ))}
        {cluster.moreFaces > 0 && (
          <View style={[styles.more, styles.overlap, { backgroundColor: t.line }]}>
            <Text style={{ color: t.dim, fontSize: 10, fontWeight: '600' }}>
              +{cluster.moreFaces}
            </Text>
          </View>
        )}
      </View>

      <Text style={[styles.suggestionText, { color: t.dim }]} numberOfLines={2}>
        {cluster.names} — {cluster.sharedEventCount}{' '}
        {cluster.sharedEventCount === 1 ? 'event' : 'events'} together
      </Text>

      <Pressable
        onPress={onMake}
        accessibilityRole="button"
        accessibilityLabel={`Make a group with ${cluster.names}`}
        hitSlop={8}
        style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.groupThem, { color: t.accent }]}>Group them</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  form: { flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 18 },

  /* A rule and a line, not a box. See the note on `ClusterCard`. */
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 14,
  },
  suggestionText: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 18 },
  groupThem: { fontSize: 13.5, fontWeight: '600' },

  stack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  overlap: { marginLeft: -8 },
  faceFallback: { alignItems: 'center', justifyContent: 'center' },
  more: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  formLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  input: { borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 15, fontSize: 16, marginTop: 8 },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  rule: { borderTopWidth: 1, marginTop: 18, paddingTop: 18 },
  addLead: { marginTop: 18 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13.5, fontWeight: '600' },
  chipX: { fontSize: 14, opacity: 0.7 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  create: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  createText: { fontSize: 15, fontWeight: '600' },
  cancel: { fontSize: 14.5 },
  live: { fontSize: 12.5, marginLeft: 'auto' },
  error: { width: '100%', fontSize: 13 },
});
