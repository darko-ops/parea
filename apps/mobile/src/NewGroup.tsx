/**
 * Making a group, on a page of its own.
 *
 * It was a card that unfolded inside the Groups tab: press `New group` and the
 * form appeared between the heading and the rooms, pushing them down. That
 * shape came from the web, where a card sits in a column with room around it.
 * On a phone it meant a form the width of a list item, with a keyboard over the
 * bottom third of it, and the thing it was part of still scrolling behind.
 *
 * A page instead, with the same two questions the web card asks and in the same
 * order: what is it called, and who is in it. Naming comes first because it is
 * the one answer somebody already has — the people are a list to work through,
 * and a form that opens on a list to work through reads as a chore before it
 * reads as a room.
 *
 * ## Nothing is written until Create
 *
 * The property `CreateGroup.tsx` states and this keeps: no row, no
 * notification, no request until the button at the top right. Removing somebody
 * from the list tells them nothing. Backing out loses nothing, because there
 * was nothing. It is what makes arriving here with people already chosen — from
 * a cluster — a suggestion rather than a presumption.
 *
 * ## Memberships, not invitations
 *
 * `createGroupFrom` writes everybody in as a member. That is deliberate and it
 * is argued at length in `CreateGroup.tsx`: everybody here already has the
 * photographs from the events they were at with you, so asking them to accept a
 * room they are effectively in is a formality that arrives as a chore. It is
 * still a real thing to do to somebody, so the sentence saying so sits above
 * the button rather than in a confirmation after it.
 *
 * The one difference from the card: search. The card offered the people a
 * cluster suggested and the handful of others it came with, and nobody else —
 * so a group with one person in it who had never been at an event with you
 * could not be made here at all. `InvitePicker` is the same control the album
 * flow uses, friends first and a handle search under it.
 */

import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { Api, ClusterPerson, InvitablePerson } from './api';
import type { GroupTheme } from './Groups';
import { InvitePicker } from './InvitePeople';

export function NewGroup({
  api,
  t,
  dark,
  /**
   * Who is in it before anybody chooses.
   *
   * A cluster's people, when this was opened from one — the same set the card
   * used to arrive holding. Empty from a `+`.
   */
  people = [],
  /** A cluster's suggested name, for the same reason. */
  suggestedName = '',
  onCancel,
  onCreated,
}: {
  api: Api;
  t: GroupTheme;
  dark: boolean;
  people?: ClusterPerson[];
  suggestedName?: string;
  onCancel: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [name, setName] = useState(suggestedName);
  /*
   * A cluster's people arrive as `ClusterPerson` and the picker speaks
   * `InvitablePerson`. The same person under two names, because one list comes
   * from "who you keep ending up with" and the other from "who you may ask" —
   * and only `actorId` is needed to create the group, which is what the two
   * have in common.
   */
  const [picked, setPicked] = useState<InvitablePerson[]>(() =>
    people.map((person) => ({
      actorId: person.actorId,
      // A cluster carries no handle: it is built from who was at which event,
      // and the name is what the picker draws anyway.
      handle: null,
      displayName: person.name,
      avatar: person.avatarUrl,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim().length > 0;

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const group = await api.createGroupFrom(
        trimmed,
        picked.map((person) => person.actorId),
      );
      onCreated(group.id);
    } catch {
      // The page keeps everything it had. Somebody who has just chosen eleven
      // people is not being asked to choose them again.
      setError('That did not go through. Try again in a moment.');
      setBusy(false);
    }
  }, [api, busy, name, onCreated, picked]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />

      {/*
        Cancel and Create in the bar, not buttons at the foot of a scroll.

        The list of people is as long as somebody's friends, so a Create at the
        bottom is a Create you have to scroll to — and this is a form whose
        second field is optional, which means the common case is "type a name,
        press Create" with nothing in between.
      */}
      <View style={styles.bar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.barCancel, { color: t.fg }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.barTitle, { color: t.fg }]}>New group</Text>
        <Pressable
          onPress={() => void create()}
          disabled={!ready || busy}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy }}
        >
          <Text
            style={[
              styles.barDo,
              { color: ready && !busy ? t.accent : t.dim },
            ]}
          >
            {busy ? 'Creating…' : 'Create'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.label, { color: t.dim }]}>GROUP TITLE</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Sunday roast"
            placeholderTextColor={t.dim}
            maxLength={80}
            autoFocus={suggestedName === ''}
            selectTextOnFocus
            returnKeyType="done"
            style={[styles.input, { borderColor: t.line, color: t.fg, backgroundColor: t.card }]}
            accessibilityLabel="Group title"
          />
          {suggestedName !== '' && (
            <Text style={[styles.hint, { color: t.dim }]}>
              Suggested from the evening you were all at — change it to anything.
            </Text>
          )}

          <View style={styles.section}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: t.dim }]}>ADD FRIENDS</Text>
              {picked.length > 0 && (
                <Text style={[styles.hint, { color: t.dim }]}>{picked.length} chosen</Text>
              )}
            </View>
            <InvitePicker api={api} t={t} picked={picked} onChange={setPicked} />
          </View>

          {/*
            Above the button rather than in a confirmation after it, so it is
            read before the decision instead of reported after it.
          */}
          <Text style={[styles.hint, { color: t.dim }]}>
            {picked.length > 0
              ? 'Everyone you add is in the group straight away — they are not asked first. They can leave whenever they like.'
              : 'You can make it empty and add people later, from the group itself.'}
          </Text>

          {error && <Text style={[styles.hint, { color: t.warn }]}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* The same 60pt status-bar allowance the picker uses, so the two screens the
     `+` can open start their bars at the same height. */
  bar: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barCancel: { fontSize: 15.5 },
  barTitle: { fontSize: 16, fontWeight: '600' },
  barDo: { fontSize: 15.5, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: { fontSize: 13, lineHeight: 19 },
  section: { paddingTop: 18, gap: 8 },
});
