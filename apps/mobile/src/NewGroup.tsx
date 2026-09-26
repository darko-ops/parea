/**
 * Making a chat, or making a group — one page, two things.
 *
 * ## The difference, and why it is a prop rather than two files
 *
 * A **chat** is made out of people and nothing else. The `+` on the Chats tab
 * asks who and then stops: there is no title field, the word "group" does not
 * appear, and the room is called after whoever is in it until somebody decides
 * otherwise. That is the common case by a long way — almost no conversation is
 * a standing arrangement on the day it starts, and asking for a name up front
 * made every one of them a small act of administration before it was a chat.
 *
 * A **group** is the other thing, and it is still reachable: Find offers one
 * beside a cluster of people you keep ending up in events with, and that flow
 * arrives with a suggested name because somebody there is deliberately naming
 * a standing thing rather than starting a conversation.
 *
 * One file because the middle of the screen — who is in it, and the sentence
 * about what adding them does — is the same screen in both, and it is the two
 * thirds that matter. What differs is a field, a heading and three words, and
 * two files would keep the picker in step by hand.
 *
 * A chat can become a group later, on its own page, by being named. Nothing
 * here decides that; see `PATCH /api/groups/[id]`.
 *
 * ---
 *
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
   * Which of the two this is. See the note at the top of the file.
   *
   * No default. The two say different words and write different rows, and a
   * screen that guessed would be the one place in the product where "is this
   * a chat or a group" is decided by omission.
   */
  kind,
  /**
   * Who is in it before anybody chooses.
   *
   * A cluster's people, when this was opened from one — the same set the card
   * used to arrive holding. Empty from a `+`.
   */
  people = [],
  /** A cluster's suggested name, for the same reason. Never in chat mode. */
  suggestedName = '',
  onCancel,
  onCreated,
}: {
  api: Api;
  t: GroupTheme;
  dark: boolean;
  kind: 'chat' | 'group';
  people?: ClusterPerson[];
  suggestedName?: string;
  onCancel: () => void;
  onCreated: (groupId: string) => void;
}) {
  const chat = kind === 'chat';
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

  /*
   * What makes the button pressable, and the two answers are the two screens.
   *
   * A group needs a name — that is what somebody came here to give it, and a
   * nameless one made from this page would be indistinguishable from a chat.
   * A chat needs a person: it is a conversation, and a conversation with
   * nobody is a room, which is the thing this screen is deliberately not
   * making. Neither needs both.
   */
  const ready = chat ? picked.length > 0 : name.trim().length > 0;

  const create = useCallback(async () => {
    const trimmed = name.trim();
    const ids = picked.map((person) => person.actorId);
    if (busy) return;
    if (chat ? ids.length === 0 : !trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // No name goes up from a chat, not even an empty one: the server takes
      // its absence as "title this from its people" and that is the whole of
      // the difference between the two rows this page can write.
      const group = await api.createChat(ids, chat ? undefined : trimmed);
      onCreated(group.id);
    } catch {
      // The page keeps everything it had. Somebody who has just chosen eleven
      // people is not being asked to choose them again.
      setError('That did not go through. Try again in a moment.');
      setBusy(false);
    }
  }, [api, busy, chat, name, onCreated, picked]);

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
        <Text style={[styles.barTitle, { color: t.fg }]}>
          {chat ? 'New chat' : 'New group'}
        </Text>
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
          {/*
            The name, and only on the screen that is asking for one.

            A chat has no field here at all — not a blank one, not an optional
            one labelled "optional". An optional field is still a question, and
            the question is the thing this screen was changed to stop asking:
            somebody starting a conversation with one person has no name in
            mind for it, and offering the box invites them to invent one.
          */}
          {!chat && (
            <>
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
                style={[
                  styles.input,
                  { borderColor: t.line, color: t.fg, backgroundColor: t.card },
                ]}
                accessibilityLabel="Group title"
              />
              {suggestedName !== '' && (
                <Text style={[styles.hint, { color: t.dim }]}>
                  Suggested from the evening you were all at — change it to anything.
                </Text>
              )}
            </>
          )}

          {/*
            The people. On a chat this is the whole screen, so it starts at the
            top rather than under the space a field used to take.
          */}
          <View style={chat ? undefined : styles.section}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: t.dim }]}>
                {chat ? 'WHO ARE YOU TALKING TO' : 'ADD FRIENDS'}
              </Text>
              {picked.length > 0 && (
                <Text style={[styles.hint, { color: t.dim }]}>{picked.length} chosen</Text>
              )}
            </View>
            <InvitePicker api={api} t={t} picked={picked} onChange={setPicked} />
          </View>

          {/*
            Above the button rather than in a confirmation after it, so it is
            read before the decision instead of reported after it.

            The chat's version says what a chat is rather than what adding
            somebody does to them, because on that screen the two are the same
            sentence: one person is a conversation with that person, and more
            than one is a room. It is the only place the product explains that,
            and it belongs here — before the choice, not after it.
          */}
          <Text style={[styles.hint, { color: t.dim }]}>
            {chat
              ? picked.length > 1
                ? 'Everybody here is in it straight away and can say something. You can give it a name later, from the chat itself.'
                : 'Pick one person for a conversation with them, or more for a group. Nobody is asked first, and anybody can leave.'
              : picked.length > 0
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
