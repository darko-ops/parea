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
 * The resting card: who they are, how often, and one button.
 *
 * `primary` is one per screen. The first card is filled and the rest outlined,
 * so the screen has a single primary action — passed in rather than worked out
 * here, because "first" is a fact about the list.
 */
export function ClusterCard({
  cluster,
  primary,
  onMake,
  t,
}: {
  cluster: Cluster;
  primary: boolean;
  onMake: () => void;
  t: GroupTheme;
}) {
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <View style={styles.stack}>
        {cluster.faces.map((person, i) => (
          <View key={i} style={i === 0 ? undefined : styles.overlap}>
            <FaceOf person={person} size={36} t={t} />
          </View>
        ))}
        {cluster.moreFaces > 0 && (
          <View style={[styles.more, styles.overlap, { backgroundColor: t.line }]}>
            <Text style={{ color: t.dim, fontSize: 12, fontWeight: '600' }}>
              +{cluster.moreFaces}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.what}>
        <Text style={[styles.names, { color: t.fg }]} numberOfLines={2}>
          {cluster.names}
        </Text>
        {/*
          The count and nothing else. The moment this line names an event the
          card starts to look like a suggestion derived from that one event
          rather than from the people, which is the opposite of what it says.
        */}
        <Text style={[styles.meta, { color: t.dim }]}>
          Together in {cluster.sharedEventCount}{' '}
          {cluster.sharedEventCount === 1 ? 'event' : 'events'}
        </Text>
      </View>

      <Pressable
        onPress={onMake}
        accessibilityRole="button"
        accessibilityLabel={`Make a group with ${cluster.names}`}
        style={({ pressed }) => [
          styles.make,
          primary
            ? { backgroundColor: t.accent, borderColor: t.accent }
            : { borderColor: t.accent },
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.makeText, { color: primary ? t.onAccent : t.accent }]}>
          Make a group
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The form the card becomes, and the one `New group` opens with nothing in it.
 *
 * `cluster` null is the from-scratch path: no suggested name, no preselected
 * chips, and `Create` stays disabled until the name has something in it.
 */
export function CreateGroupForm({
  api,
  cluster,
  also,
  t,
  onCancel,
  onCreated,
}: {
  api: Api;
  cluster: Cluster | null;
  also: ClusterPerson[];
  t: GroupTheme;
  onCancel: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [name, setName] = useState(cluster?.suggestedName ?? '');
  const [picked, setPicked] = useState<ClusterPerson[]>(cluster?.people ?? []);
  const [extra, setExtra] = useState<ClusterPerson[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => [...picked, ...extra], [picked, extra]);
  const offered = useMemo(
    () => also.filter((person) => !chosen.some((p) => p.actorId === person.actorId)),
    [also, chosen],
  );

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const group = await api.createGroupFrom(
        trimmed,
        chosen.map((person) => person.actorId),
      );
      onCreated(group.id);
    } catch {
      // The form keeps everything it had. Somebody who just chose eleven
      // people is not being asked to choose them again.
      setError('That did not go through. Try again in a moment.');
      setBusy(false);
    }
  }, [api, name, chosen, onCreated]);

  const shown = expanded ? chosen : chosen.slice(0, CHIPS_SHOWN);
  const hidden = chosen.length - shown.length;

  return (
    <View style={[styles.card, styles.form, { backgroundColor: t.card, borderColor: t.accent }]}>
      <Text style={[styles.formLabel, { color: t.dim }]}>NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name the group"
        placeholderTextColor={t.dim}
        maxLength={80}
        selectTextOnFocus
        style={[styles.input, { borderColor: t.line, color: t.fg }]}
        accessibilityLabel="Name the group"
      />
      {cluster?.suggestedName != null && (
        <Text style={[styles.hint, { color: t.dim }]}>
          Suggested from the event you were all at — change it to anything.
        </Text>
      )}

      <View style={[styles.rule, { borderTopColor: t.line }]}>
        <View style={styles.labelRow}>
          <Text style={[styles.formLabel, { color: t.dim }]}>WHO IS IN IT</Text>
          {picked.length > 0 && (
            <Text style={[styles.hint, { color: t.dim }]}>— {picked.length} preselected</Text>
          )}
        </View>

        {/*
          Three sentences for three situations. Opened from a cluster there are
          chips to remove; opened from `New group` there are none, and "tap to
          take somebody out" would be an instruction about controls that are
          not on screen. The consent half survives in both cases where somebody
          else can end up in the group, and is above the button in both.
        */}
        <Text style={[styles.hint, { color: t.dim }]}>
          {picked.length > 0
            ? 'Tap to take somebody out. They are told when the group is made, and can add photos without being invited again.'
            : offered.length > 0
              ? 'Anybody you add is told when the group is made, and can add photos without being invited again.'
              : 'Just you, for now. You can add people from the group once it exists.'}
        </Text>

        <View style={styles.chips}>
          {shown.map((person) => (
            <Pressable
              key={person.actorId}
              accessibilityRole="button"
              accessibilityState={{ selected: true }}
              accessibilityLabel={`${person.name}, take out`}
              onPress={() => {
                setPicked((list) => list.filter((p) => p.actorId !== person.actorId));
                setExtra((list) => list.filter((p) => p.actorId !== person.actorId));
              }}
              style={({ pressed }) => [
                styles.chip,
                // No soft fill: the phone's theme has no `accent-soft` token,
                // and the accent border plus accent text already tell a chosen
                // chip from an offered one without inventing a colour here.
                { borderColor: t.accent },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <FaceOf person={person} size={26} t={t} />
              <Text style={[styles.chipText, { color: t.accent }]}>{firstNameOf(person.name)}</Text>
              <Text style={[styles.chipX, { color: t.accent }]}>×</Text>
            </Pressable>
          ))}
          {hidden > 0 && (
            // Eleven chips at full size push the button off the bottom, which
            // is the one place it must not be — the consent line is above it.
            <Pressable
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${hidden} more`}
              style={[styles.chip, { borderColor: t.line }]}
            >
              <Text style={[styles.chipText, { color: t.dim }]}>+{hidden} more</Text>
            </Pressable>
          )}
        </View>

        {offered.length > 0 && (
          <>
            <Text style={[styles.hint, styles.addLead, { color: t.dim }]}>
              Add somebody who was not at those events
            </Text>
            <View style={styles.chips}>
              {offered.map((person) => (
                <Pressable
                  key={person.actorId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: false }}
                  accessibilityLabel={`Add ${person.name}`}
                  onPress={() => setExtra((list) => [...list, person])}
                  style={({ pressed }) => [
                    styles.chip,
                    { borderColor: t.line },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <FaceOf person={person} size={26} t={t} />
                  <Text style={[styles.chipText, { color: t.dim }]}>
                    {firstNameOf(person.name)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>

      <View style={[styles.rule, styles.actions, { borderTopColor: t.line }]}>
        {error && <Text style={[styles.error, { color: '#b3261e' }]}>{error}</Text>}
        <Pressable
          onPress={create}
          disabled={busy || name.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Create group"
          style={({ pressed }) => [
            styles.create,
            { backgroundColor: t.accent },
            { opacity: busy || name.trim().length === 0 ? 0.5 : pressed ? 0.7 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text style={[styles.createText, { color: t.onAccent }]}>Create group</Text>
          )}
        </Pressable>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancel, { color: t.dim }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.live, { color: t.dim }]}>
          {chosen.length + 1} {chosen.length + 1 === 1 ? 'person' : 'people'}
        </Text>
      </View>
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

  stack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  overlap: { marginLeft: -12 },
  faceFallback: { alignItems: 'center', justifyContent: 'center' },
  more: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  what: { flex: 1, minWidth: 0, gap: 3 },
  names: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  meta: { fontSize: 12.5 },

  make: { flexShrink: 0, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  makeText: { fontSize: 14.5, fontWeight: '600' },

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
