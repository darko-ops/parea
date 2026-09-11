/**
 * The conversation about an event, on a phone.
 *
 * The messenger existed on the web and did not exist here at all — the one
 * feature of the product that was reachable from a browser and not from the
 * app people actually take to the event. This is the same thread, with the
 * same rules, drawn for a screen that is 393 points wide.
 *
 * ## What is carried over from `Thread.tsx` on the web, deliberately
 *
 *   - **Posting is `contribute`, plus an account.** Everybody who may see the
 *     event may read it. That is not a new rule invented for messages, it is
 *     the rule the event already had, and the server decides it: this screen
 *     reads `feed.canPost` rather than inferring anything from holding a link.
 *   - **A deleted message leaves a gap.** The ones either side of a silently
 *     removed message appear to be answering each other.
 *   - **The mention list offers this event's contributors and nobody else.**
 *     A picker that reaches further is a way to find out who exists by typing
 *     letters at it, and this is the one text field a link-holder can use.
 *   - **`@name` is marked, not resolved.** It says what somebody typed. It
 *     does not assert that the person exists and it cannot be made to render
 *     anything but characters that were already going to be shown.
 *   - **The empty state is an invitation.** "Nothing said yet" describes what
 *     you can already see; this says what the space is for.
 *   - **Reaching the bottom is what marks it read.** The same rule the unread
 *     banner over the cover clears on.
 *
 * ## What is native rather than borrowed
 *
 * The list is bottom-anchored by inverting it rather than by scrolling to the
 * end after layout. An inverted `FlatList` starts at the newest message with
 * no measuring pass, which is the difference between opening on the
 * conversation and watching it jump once. It also makes "reaching the bottom"
 * `onStartReached` — the vocabulary is upside down and the behaviour is not.
 */

import { Image } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { ago } from '@parea/cards';

import { ApiError, REACTIONS, type Api, type Message, type Roster } from './api';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';

/** Somebody the mention list may offer: a contributor to this event. */
export type Mentionable = { key: string; name: string; mine: boolean };

export function Thread({
  api,
  eventId,
  messages,
  canPost,
  people,
  t,
  keyboardOffset = 0,
  onChanged,
  onSeen,
}: {
  api: Api;
  eventId: string;
  messages: Message[];
  /** Whether this viewer may post. The server's answer, never a guess. */
  canPost: boolean;
  /** This event's contributors, for the mention list. Never anybody else. */
  people: Mentionable[];
  t: GroupTheme;
  /**
   * How far down the screen this pane starts.
   *
   * `KeyboardAvoidingView` measures its own frame from `onLayout`, which is
   * relative to its parent — and this one's parent is the album's page, which
   * is pinned below the cover rather than at the top of the screen. Without
   * the offset the composer is lifted by that much too little and ends up
   * behind the keyboard by exactly the height of the header.
   */
  keyboardOffset?: number;
  /** Re-reads the feed, which is where the thread lives. */
  onChanged: () => void | Promise<void>;
  /** Called when the thread has actually been read. */
  onSeen: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<TextInput>(null);

  /*
   * Newest first, because the list is inverted. A tombstone with a body is a
   * message that was edited to nothing rather than deleted, which the web
   * keeps and so does this.
   */
  const live = useMemo(
    () => messages.filter((m) => !m.deleted || m.body === '').reverse(),
    [messages],
  );

  const post = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      await api.postMessage(eventId, body);
      setDraft('');
      await onChanged();
    } catch (err) {
      // The draft stays in the box. Losing what somebody typed because a
      // request failed is the failure mode this is written to avoid.
      setError(explain(err));
    } finally {
      setPosting(false);
    }
  }, [api, draft, eventId, onChanged, posting]);

  const react = useCallback(
    async (id: string, emoji: string) => {
      await api.react(id, emoji).catch(() => {});
      await onChanged();
    },
    [api, onChanged],
  );

  const remove = useCallback(
    (id: string) => {
      Alert.alert('Delete this message?', 'It leaves a gap saying it was deleted.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await api.deleteMessage(id).catch(() => {});
            await onChanged();
          },
        },
      ]);
    },
    [api, onChanged],
  );

  /*
   * The mention list, and the fragment it is completing.
   *
   * Only the contributors of this event, ever — see the note at the top. Five
   * at most, because this sits above the keyboard and a sixth row would push
   * the conversation off the screen to offer a name nobody was looking for.
   */
  const mention = useMemo(() => {
    const match = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(draft);
    if (!match) return null;
    const term = match[1]!.toLowerCase();
    const found = people
      .filter((person) => !person.mine)
      .filter((person) => person.name.toLowerCase().replace(/^@/, '').startsWith(term))
      .slice(0, 5);
    return found.length > 0 ? found : null;
  }, [draft, people]);

  const complete = useCallback(
    (name: string) => {
      setDraft(draft.replace(/@[\p{L}\p{N}_-]*$/u, `@${name.replace(/^@/, '')} `));
      box.current?.focus();
    },
    [draft],
  );

  return (
    <KeyboardAvoidingView
      style={styles.pane}
      // The composer is pinned to the bottom, so the keyboard would sit on top
      // of it. `padding` is the iOS answer and `height` the Android one; both
      // are wrong on the other platform.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset}
    >
      {live.length === 0 ? (
        /*
          An invitation rather than a report of emptiness. "Nothing said yet"
          describes the state somebody can already see; this says what the
          space is for, which is the only thing that turns an empty box into a
          first message.
        */
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: t.fg }]}>Talk about the moment</Text>
          <Text style={[styles.emptyBody, { color: t.dim }]}>
            Ask for a missing photo, share what happened or let everyone know
            when you have added yours.
          </Text>
        </View>
      ) : (
        <FlatList
          data={live}
          inverted
          keyExtractor={(message) => message.id}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          // Inverted, so the start of the list is the bottom of the screen.
          // Arriving there is the definition of having read it — the same rule
          // the banner over the cover clears on.
          onStartReached={onSeen}
          onStartReachedThreshold={0.05}
          renderItem={({ item }) => (
            <Row
              message={item}
              canPost={canPost}
              t={t}
              onReact={(emoji) => void react(item.id, emoji)}
              onDelete={() => remove(item.id)}
              onEdit={(body) => void api.editMessage(item.id, body).then(onChanged)}
            />
          )}
        />
      )}

      {mention && canPost && (
        <View style={[styles.mentions, { backgroundColor: t.card, borderTopColor: t.line }]}>
          {mention.map((person) => (
            <Pressable
              key={person.key}
              onPress={() => complete(person.name)}
              style={({ pressed }) => [
                styles.mention,
                { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.mentionText, { color: t.fg }]}>{person.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[styles.composer, { backgroundColor: t.card, borderTopColor: t.line }]}>
        {canPost ? (
          <>
            {/* Only when something went wrong. A standing line under every
                message anybody ever writes is a line nobody reads after the
                first day; who can read this is what the placeholder says. */}
            {error && <Text style={[styles.error, { color: t.dim }]}>{error}</Text>}
            <View style={styles.composerRow}>
              <TextInput
                ref={box}
                value={draft}
                onChangeText={setDraft}
                placeholder="Message everyone in this event…"
                placeholderTextColor={t.dim}
                multiline
                style={[styles.field, { color: t.fg, borderColor: t.line }]}
                accessibilityLabel="Message everyone in this event"
              />
              <Pressable
                onPress={() => void post()}
                disabled={posting || draft.trim() === ''}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={({ pressed }) => [
                  styles.send,
                  {
                    backgroundColor: t.accent,
                    opacity: draft.trim() === '' || posting ? 0.4 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.sendGlyph, { color: t.onAccent }]}>↑</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={[styles.error, { color: t.dim }]}>
            Only people who can add photos can post. Everyone in the event can
            read it.
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Row({
  message,
  canPost,
  t,
  onReact,
  onDelete,
  onEdit,
}: {
  message: Message;
  canPost: boolean;
  t: GroupTheme;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (message.deleted) {
    // A gap that says so, rather than a message quietly missing from the
    // middle of a conversation.
    return <Text style={[styles.gone, { color: t.dim }]}>Message deleted</Text>;
  }

  const mine = message.author.mine;
  const lens = lensFor(message.author.key);

  return (
    <View style={[styles.row, mine && styles.rowMine]}>
      {message.author.avatarUrl ? (
        <Image
          source={{ uri: message.author.avatarUrl }}
          style={[styles.face, { backgroundColor: t.line }]}
          contentFit="cover"
          transition={120}
        />
      ) : (
        /*
          The letter on their lens, never a silhouette — and the lens is keyed
          on the per-event author key, so the same person keeps one colour
          down the thread without an actor id ever crossing the boundary.
        */
        <View style={[styles.face, styles.faceBlank, { backgroundColor: lens.fill }]}>
          <Text style={[styles.faceLetter, { color: lens.ink }]}>
            {initialOf(message.author.name)}
          </Text>
        </View>
      )}

      <View style={[styles.said, mine && styles.saidMine]}>
        <Text style={[styles.meta, { color: t.dim }]} numberOfLines={1}>
          {!mine && <Text style={[styles.metaName, { color: t.fg }]}>{message.author.name} </Text>}
          {mine && 'You '}
          {ago(new Date(message.createdAt), new Date())}
          {message.edited && ' · edited'}
        </Text>

        {editing !== null ? (
          <View style={styles.editing}>
            <TextInput
              value={editing}
              onChangeText={setEditing}
              multiline
              autoFocus
              style={[styles.field, { color: t.fg, borderColor: t.line }]}
              accessibilityLabel="Edit your message"
            />
            <View style={styles.editActions}>
              <Pressable
                onPress={() => {
                  const body = editing.trim();
                  if (body) onEdit(body);
                  setEditing(null);
                }}
              >
                <Text style={[styles.editAction, { color: t.accent }]}>Save</Text>
              </Pressable>
              <Pressable onPress={() => setEditing(null)}>
                <Text style={[styles.editAction, { color: t.dim }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            // Long press rather than a menu glyph on every message: three dots
            // beside each of your own is a permanent invitation to delete
            // them, and on this width it competes with the name and the time
            // for one line.
            onLongPress={
              mine
                ? () =>
                    Alert.alert('Your message', undefined, [
                      { text: 'Edit', onPress: () => setEditing(message.body) },
                      { text: 'Delete', style: 'destructive', onPress: onDelete },
                      { text: 'Cancel', style: 'cancel' },
                    ])
                : undefined
            }
            accessibilityRole={mine ? 'button' : 'text'}
          >
            {mine ? (
              <View style={[styles.bubble, { backgroundColor: t.accent }]}>
                <Text style={[styles.bodyText, { color: t.onAccent }]}>
                  {/* Inside your own bubble the accent is the background, so a
                      mention is marked by weight instead of by colour — the
                      distinction still has to survive, or `@ana` in a message
                      you sent reads as three characters of prose. */}
                  {withMentions(message.body, styles.mentionOnAccent)}
                </Text>
              </View>
            ) : (
              <Text style={[styles.bodyText, { color: t.fg }]}>
                {withMentions(message.body, { color: t.accent })}
              </Text>
            )}
          </Pressable>
        )}

        {(message.reactions.length > 0 || canPost) && (
          <View style={[styles.chips, mine && styles.chipsMine]}>
            {message.reactions.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                disabled={!canPost}
                onPress={() => onReact(reaction.emoji)}
                accessibilityRole="button"
                accessibilityState={{ selected: reaction.mine }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: t.card,
                    borderColor: reaction.mine ? t.accent : t.line,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: t.fg }]}>
                  {reaction.emoji} {reaction.count}
                </Text>
              </Pressable>
            ))}
            {canPost &&
              (picking ? (
                REACTIONS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => {
                      setPicking(false);
                      onReact(emoji);
                    }}
                    style={[styles.chip, { backgroundColor: t.card, borderColor: t.line }]}
                  >
                    <Text style={styles.chipText}>{emoji}</Text>
                  </Pressable>
                ))
              ) : (
                <Pressable
                  onPress={() => setPicking(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add a reaction"
                  style={[styles.chip, { backgroundColor: t.card, borderColor: t.line }]}
                >
                  <Text style={[styles.chipText, { color: t.dim }]}>+</Text>
                </Pressable>
              ))}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Who is in the event, and what they have put in.
 *
 * The third pane, and the one that answers "who else can see this photograph
 * of me" — a question the people in a room are entitled to an answer to. The
 * server already computes this roster for the web's People tab; this draws it.
 */
export function People({ roster, t }: { roster: Roster[]; t: GroupTheme }) {
  return (
    <FlatList
      data={roster}
      keyExtractor={(person, i) => person.actorId ?? `${person.name}-${i}`}
      contentContainerStyle={styles.people}
      renderItem={({ item }) => {
        const lens = lensFor(item.actorId ?? item.name);
        return (
          <View style={[styles.personRow, { borderBottomColor: t.line }]}>
            {item.avatarUrl ? (
              <Image
                source={{ uri: item.avatarUrl }}
                style={[styles.personFace, { backgroundColor: t.line }]}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <View style={[styles.personFace, styles.faceBlank, { backgroundColor: lens.fill }]}>
                <Text style={[styles.personLetter, { color: lens.ink }]}>
                  {initialOf(item.name)}
                </Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.personName, { color: t.fg }]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.handle && (
                <Text style={[styles.personHandle, { color: t.dim }]} numberOfLines={1}>
                  @{item.handle}
                </Text>
              )}
            </View>
            <Text style={[styles.personHandle, { color: t.dim }]}>{standing(item)}</Text>
          </View>
        );
      }}
    />
  );
}

/** The right-hand line: what this person is to the event, in three words. */
function standing(person: Roster): string {
  if (person.role === 'invited') return 'Asked';
  if (person.role === 'creator') return 'Host';
  if (person.photoCount === 0) return 'Here';
  return `${person.photoCount} ${person.photoCount === 1 ? 'photo' : 'photos'}`;
}

/**
 * Draws `@name` as a mention and everything else as text.
 *
 * Deliberately not a link and deliberately not looked up — the same call the
 * web makes. It marks what somebody typed; it does not assert that the person
 * exists, and it cannot be made to render anything but a run of characters
 * that were already going to be shown.
 */
function withMentions(body: string, mark: StyleProp<TextStyle>) {
  return body.split(/(@[\p{L}\p{N}_-]+)/u).map((part, i) =>
    part.startsWith('@') && part.length > 1 ? (
      <Text key={i} style={mark}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

/** The route's own words where it has any, and one sentence where it has not. */
function explain(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'too_long':
        return `That is longer than ${err.body.max} characters.`;
      case 'sign_in_required':
        return 'Sign in to post.';
      case 'forbidden':
        return 'Only people who can add photos can post.';
    }
  }
  return 'Could not post that.';
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  /* Inverted, so `paddingTop` is the gap under the composer and the column
     grows upwards from it. */
  list: { padding: 14, paddingHorizontal: 16, gap: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  /* Your own, mirrored. The avatar stays — a thread where one person has no
     face reads as a system message rather than as somebody talking. */
  rowMine: { flexDirection: 'row-reverse' },
  face: { width: 32, height: 32, borderRadius: 16 },
  faceBlank: { alignItems: 'center', justifyContent: 'center' },
  faceLetter: { fontSize: 13, fontWeight: '700' },
  said: { flex: 1, minWidth: 0, gap: 2 },
  saidMine: { alignItems: 'flex-end' },
  meta: { fontSize: 12.5 },
  metaName: { fontWeight: '700' },
  bodyText: { fontSize: 15, lineHeight: 21 },
  mentionOnAccent: { fontWeight: '700' },
  /* Square at the corner nearest the avatar, which is the shape every
     messenger uses to say which side a message came from. */
  bubble: {
    borderRadius: 14,
    borderBottomRightRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignSelf: 'flex-end',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chipsMine: { justifyContent: 'flex-end' },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  chipText: { fontSize: 13 },
  gone: { fontSize: 13, fontStyle: 'italic' },
  editing: { gap: 8 },
  editActions: { flexDirection: 'row', gap: 16 },
  editAction: { fontSize: 14, fontWeight: '600' },
  mentions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10, borderTopWidth: 1 },
  mention: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  mentionText: { fontSize: 13.5, fontWeight: '600' },
  /* Pinned, with the home indicator's strip inside the padding rather than
     under the field. */
  composer: { borderTopWidth: 1, paddingTop: 12, paddingHorizontal: 16, paddingBottom: 30, gap: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  field: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontSize: 15,
    maxHeight: 120,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendGlyph: { fontSize: 17, fontWeight: '600' },
  error: { fontSize: 13, lineHeight: 18 },
  people: { padding: 16, paddingBottom: 40 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1 },
  personFace: { width: 38, height: 38, borderRadius: 10 },
  personLetter: { fontSize: 14, fontWeight: '700' },
  personName: { fontSize: 15.5, fontWeight: '600' },
  personHandle: { fontSize: 13 },
});
