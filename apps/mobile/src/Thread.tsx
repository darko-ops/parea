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
 *
 * ## Two rooms, one drawing: `shape`
 *
 * A group's chat and an album's comments are the same thread with the same
 * rules, and this file had drawn them as two things: your own words in an
 * accent bubble against the right-hand edge, a round arrow to send them, and
 * a box that offered to "message everyone in this album". A reader arriving
 * on a tab called Comments found a messenger.
 *
 * The board was rewritten first and then the chat followed it, one piece at a
 * time, and what is left of the difference is the words. Both rooms are a
 * face, a name, a time and the words, with nothing drawn around any of them;
 * both hang your own from the right-hand edge; both type into the site's own
 * composer. `shape` chooses between Post and Send, between "Add a comment…"
 * and "Message the group…", and between two empty-state lines. That is all it
 * does, and the prop stays because a room still has to be able to say which
 * one it is.
 *
 * Each piece went for its own reason, and they are worth keeping straight:
 *
 *   - **The fill.** A bubble is how a messenger says who is speaking, and the
 *     side of the screen already says it. A column of solid blocks is read as
 *     traffic; what is in this one is people talking about an evening, at the
 *     length people write when they are not being charged a bubble for it.
 *   - **The side.** Kept, in both rooms. It is seen before a word is read and
 *     it is how anybody finds the last thing they said themselves. An
 *     alignment, not a costume: the block moves and its lines do not.
 *   - **The strip.** A pill and a round arrow with a rule across the screen
 *     is a messenger's furniture, and the card the site draws is better in
 *     both rooms — see the note beside it.
 *
 * One prop rather than two components, throughout: everything that is *hard*
 * here — who may post, the tombstones, the mention rules, marking it read —
 * is the same in both rooms, and a second copy of it is a second place for
 * the rules to be wrong.
 *
 * What was never the difference is the order. Oldest at the top and the
 * newest against the box you type in is not a messenger's invention — every
 * comment section under a photograph does the same — and it is what the
 * unread count is counted from.
 */

import { Image } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
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

import { ApiError, REACTIONS, type Message, type Roster } from './api';
import { EmojiPicker } from './Emoji';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Waiting } from './Waiting';

/** Somebody the mention list may offer: a contributor to this event. */
export type Mentionable = { key: string; name: string; mine: boolean };

/**
 * The four things a thread does to the server.
 *
 * Passed in rather than reached for, because the same component now draws an
 * event's conversation and a group's, and those hit different routes — a
 * message id from one table is not a message id from the other, and a
 * component that guessed which was which would be a component that can guess
 * wrong. `Reactions` is optional: a group message has none yet, and the row of
 * pills is simply not drawn when there is no way to add one.
 */
/** Which room this is, which is now only which words it uses. See the note. */
export type ThreadShape = 'chat' | 'board';

export type ThreadActions = {
  post: (body: string) => Promise<unknown>;
  edit: (messageId: string, body: string) => Promise<unknown>;
  remove: (messageId: string) => Promise<unknown>;
  /** Omitted where the room has no reactions. */
  react?: (messageId: string, emoji: string) => Promise<unknown>;
  /**
   * Taking back a reaction on a photograph, which is what a reaction *line*
   * in this thread is.
   *
   * A different route from `react` and not a variant of it: that one toggles
   * an emoji on a message, and these lines are rows of `photo_reaction`. The
   * endpoint toggles too, so calling it on one somebody already has is how it
   * comes off.
   *
   * Omitted in a room whose lines have no photographs behind them — a group's
   * — where there is nothing for it to address.
   */
  unreact?: (photoId: string, emoji: string) => Promise<unknown>;
};

export function Thread({
  actions,
  messages,
  canPost,
  people,
  t,
  shape = 'chat',
  keyboardOffset = 0,
  onChanged,
  onSeen,
  photoOf,
  onOpenPhoto,
}: {
  /** What this thread's four verbs do. See `ThreadActions`. */
  actions: ThreadActions;
  /**
   * Which room this is. See the note at the top of the file.
   *
   * Defaulted to `chat` rather than required, because a chat is what a thread
   * is until somebody says otherwise — and because the one caller that wants
   * the other is the one that has to say so.
   */
  shape?: ThreadShape;
  /**
   * The photograph a comment is about, by id.
   *
   * Optional, and absent in a group's chat — a group has no photographs of its
   * own, so every message there is to the room rather than about a picture.
   * Handed in rather than fetched: the album screen already holds every
   * photograph in the feed, and a thread that could ask for one would be a
   * second path to an album's pictures with its own rules about who may.
   */
  photoOf?: (photoId: string) => { id: string; src: string } | null;
  /** Opens that photograph. Absent where there is nowhere to open it. */
  onOpenPhoto?: (photoId: string) => void;
  /**
   * The conversation, or null while nobody knows yet.
   *
   * Null is the whole reason this is not simply an array. An empty thread and
   * an unfetched one are the same shape and mean opposite things, and both
   * callers were handing over `[]` for both — so opening a conversation showed
   * "nothing has been said here" for as long as the request took, and then the
   * conversation appeared underneath the sentence denying it existed.
   *
   * The distinction lives here rather than at the two call sites because the
   * thing that has to change is what gets *drawn*, and only this file draws it.
   */
  messages: Message[] | null;
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
  const board = shape === 'board';
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
    () => (messages ?? []).filter((m) => !m.deleted || m.body === '').reverse(),
    [messages],
  );

  const post = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      await actions.post(body);
      setDraft('');
      await onChanged();
    } catch (err) {
      // The draft stays in the box. Losing what somebody typed because a
      // request failed is the failure mode this is written to avoid.
      setError(explain(err));
    } finally {
      setPosting(false);
    }
  }, [actions, draft, onChanged, posting]);

  const react = useCallback(
    async (id: string, emoji: string) => {
      await actions.react?.(id, emoji).catch(() => {});
      await onChanged();
    },
    [actions, onChanged],
  );

  /** And off again, for the reaction lines. See `unreact` on `ThreadActions`. */
  const unreact = useCallback(
    async (photoId: string, emoji: string) => {
      await actions.unreact?.(photoId, emoji).catch(() => {});
      await onChanged();
    },
    [actions, onChanged],
  );

  /**
   * Deletes, without asking a second time.
   *
   * It used to open its own "Delete this message?" alert, which meant two
   * native alerts in a row: the long-press menu, and then this one raised from
   * inside that menu's own dismissal. iOS presents the second on a view
   * controller that is already going away, so it never appeared — you held
   * your message, chose Delete, and nothing happened at all.
   *
   * One alert is also the better shape regardless. Long-pressing a message and
   * choosing a red item is already a deliberate act, and the consequence — it
   * leaves a gap rather than vanishing — belongs in front of the decision
   * rather than in a second panel after it. See the menu in `Row`.
   */
  const remove = useCallback(
    async (id: string) => {
      await actions.remove(id).catch(() => {});
      await onChanged();
    },
    [actions, onChanged],
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

  /*
   * The box itself, lifted out of the card below only to keep that block
   * readable — one `TextInput` for both rooms, which is what it has to be:
   * two copies of a text field with a ref, a placeholder and a multiline cap
   * is two places for typing to behave differently.
   */
  const field = (
    <TextInput
      ref={box}
      value={draft}
      onChangeText={setDraft}
      /*
        What the box is for, in its own words.

        It said "Message everyone in this album…" in both rooms, which was
        wrong twice over: on the album's Comments tab it described a group
        chat, and in a group's own chat it named an album that is not what
        that room is about. The placeholder is the one line that tells
        somebody what they are about to do, so it follows the shape rather
        than the component.
      */
      placeholder={board ? 'Add a comment…' : 'Message the group…'}
      placeholderTextColor={t.dim}
      multiline
      style={[styles.field, { color: t.fg }]}
      accessibilityLabel={board ? 'Add a comment' : 'Message the group'}
    />
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
      {messages === null ? (
        /*
          Nothing said, rather than "nothing has been said".

          A thread that has not arrived is not an empty one, and drawing the
          invitation while the request is out is the screen making a claim it
          cannot support yet — one that is contradicted a moment later by the
          messages appearing underneath it.
        */
        <View style={styles.empty}>
          <Waiting size={40} />
        </View>
      ) : live.length === 0 ? (
        /*
          An invitation rather than a report of emptiness. "Nothing said yet"
          describes the state somebody can already see; this says what the
          space is for, which is the only thing that turns an empty box into a
          first message.

          One line, where it was a heading and a paragraph explaining what a
          conversation is for. Nobody needs telling; what an empty room needs
          is a reason to say the first thing, and the joke is the reason.

          A board's line names its subject instead. An empty chat is a room
          with nobody in it and the nudge is social; an empty comment section
          sits under a wall of photographs somebody has just scrolled, and the
          thing to say is about those.
        */
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: t.dim }]}>
            {board
              ? 'Say something about these photographs.'
              : 'Say something before this gets awkward.'}
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
            <ThreadRow
              message={item}
              canPost={canPost}
              t={t}
              shape={shape}
              canReact={actions.react != null}
              onReact={(emoji) => void react(item.id, emoji)}
              onDelete={() => void remove(item.id)}
              onEdit={(body) => void actions.edit(item.id, body).then(onChanged)}
              about={item.photoId ? (photoOf?.(item.photoId) ?? null) : null}
              onOpenPhoto={onOpenPhoto}
              /* Only where there is something to take back: your own
                 reaction, on a photograph, in a room that can reach it. */
              onUnreact={
                item.emoji && item.photoId && item.author.mine && actions.unreact
                  ? () => void unreact(item.photoId!, item.emoji!)
                  : undefined
              }
            />
          )}
        />
      )}

      {/*
        One box at the foot of both rooms, and only the words in it differ.

        A chat had the strip every messenger has — a pill running edge to edge
        with a round accent disc beside it and a hairline across the screen
        above — and a board has the site's card. The card won for the group's
        room as well, which is a smaller change than it sounds: the ↑ disc is
        a messenger's control and it earns its place *beside a pill*, where it
        is the one round thing in a row of round things. Dropped into a
        bordered card under a bare field it is a mystery button in a tidy box,
        and the alternative — the card with a word in it — is what both rooms
        actually want. A chat's word is Send, because a message does go
        somewhere.

        So what tells a reader which room they are in is the conversation
        above this: bubbles on sides in a chat, one column on a board. That is
        the right place for it. A composer is furniture, and drawing two kinds
        of furniture to say something the content already says is how an app
        ends up with two of everything.
      */}
      <View style={[styles.composer, { backgroundColor: t.bg }]}>
        {canPost ? (
          /*
            The site's card, point for point: a 1-point border at 14, the
            field bare inside it, and the actions under it with the error to
            the left of the button. Its own ground rather than the page's — a
            box you type into that shows the column scrolling behind it reads
            as two things overlapping rather than one thing on top.
          */
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
            {/*
              The names, inside the box they complete rather than on a bar
              above it.

              It was its own strip with its own ground and a rule along the
              top, which was of a piece with the composer when that was a
              strip too. Against a card it reads as a second object arriving
              over the conversation. The site has always put it here — a row
              of pills at the head of the composer with a hairline under them
              — and it is the better place regardless: what the list is doing
              is finishing the word under the cursor, so it belongs in the
              same box as the cursor.
            */}
            {mention && (
              <View style={[styles.mentions, { borderBottomColor: t.line }]}>
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
            {field}
            <View style={styles.actions}>
              {/* The one line worth keeping in this slot. It held a standing
                  sentence about who can read the thread, which nobody reads
                  after the first day; an error is the thing somebody needs
                  told at the moment they are told it. */}
              <Text style={[styles.note, { color: t.dim }]} numberOfLines={2}>
                {error ?? ''}
              </Text>
              <Pressable
                onPress={() => void post()}
                disabled={posting || draft.trim() === ''}
                accessibilityRole="button"
                accessibilityLabel={board ? 'Post this comment' : 'Send this message'}
                style={({ pressed }) => [
                  styles.post,
                  { backgroundColor: t.accent },
                  { opacity: draft.trim() === '' || posting ? 0.6 : pressed ? 0.8 : 1 },
                ]}
              >
                {/* The verb of the room, and the same verb in the present
                    tense while it is happening — a button that says what it
                    did is a button somebody presses twice. */}
                <Text style={[styles.postText, { color: t.onAccent }]}>
                  {board
                    ? posting
                      ? 'Posting…'
                      : 'Post'
                    : posting
                      ? 'Sending…'
                      : 'Send'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={[styles.error, { color: t.dim }]}>
            Only people who can add photos can post. Everyone in the album can
            read it.
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * One line of a thread: a comment, a reaction, or the gap a delete left.
 *
 * Exported for the photo viewer, which draws the same rows in a sheet over a
 * photograph — its own list, its own palette, and not a second drawing of a
 * comment. Everything that decides how a row *looks* is in here and everything
 * it needs comes in as props, so the only thing the viewer has to hand over is
 * a `t` in its own colours.
 */
export function ThreadRow({
  message,
  canPost,
  t,
  shape,
  canReact,
  onReact,
  onDelete,
  onEdit,
  onUnreact,
  about,
  onOpenPhoto,
}: {
  message: Message;
  canPost: boolean;
  t: GroupTheme;
  shape: ThreadShape;
  /** Whether this room has reactions at all. */
  canReact: boolean;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
  /**
   * Taking back your own reaction, where this row is one.
   *
   * A reaction line is not a message and `onDelete` would be the wrong verb
   * for it — there is no row to tombstone, only a reaction to stop having.
   * Absent where there is nothing to undo: somebody else's, or a room whose
   * caller has no way to reach it.
   */
  onUnreact?: () => void;
  /** The photograph this comment is about, where it is about one. */
  about?: { id: string; src: string } | null;
  onOpenPhoto?: (photoId: string) => void;
}) {
  const [held, setHeld] = useState(false);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const mine = message.author.mine;
  /*
   * Which edge this block hangs from, and yours hangs from the right.
   *
   * It is the one thing about a row that is seen before a word of it is
   * read, and it is how anybody finds the last thing they said themselves —
   * the name answers that only once you are already reading.
   *
   * It used to carry a fill with it in a chat, and the two came apart: the
   * side is an alignment, the fill was a costume. See the note beside the
   * words below.
   */
  const sided = mine;
  /*
   * Whether holding this row offers anything.
   *
   * Yours always does — edit and delete. Somebody else's does when there is a
   * reaction to leave on it, which is what makes a long press the way to
   * react to a comment rather than a menu for its author. A row with neither
   * takes no long press at all, so nothing opens an empty sheet.
   */
  const holdable = mine || (canPost && canReact);
  const lens = lensFor(message.author.key);

  /**
   * What a held row offers, which is a sheet of our own rather than an alert.
   *
   * It was `Alert.alert('Your message', …)` with Edit and Delete in it, which
   * meant two things: only your own rows answered a long press at all, and
   * reacting to somebody else's had to live somewhere else — a `+` pill under
   * every comment in the thread, a bordered control offering to react to a
   * sentence nobody had reacted to, drawn once per row for ever.
   *
   * An alert cannot hold a row of emoji. So the press opens `HeldSheet`: the
   * six reactions and a `+` for the rest of them, and under that the verbs
   * that belong to whoever is holding — Edit and Delete on your own words,
   * "Remove my reaction" on your own reaction.
   *
   * `held` rather than `menu`: what it describes is the row being held, and
   * the sheet is what that does.
   */
  const open = useCallback(() => setHeld(true), []);

  /*
   * Below the hooks, not above them.
   *
   * This return sat first, which meant deleting your own message crashed the
   * thread: the row renders with `menu` while the message is there and
   * without it the moment `deleted` flips, and React counts hooks by position
   * — a render with fewer than the last one is refused. The row that a delete
   * is *supposed* to leave behind was the render that could not happen.
   */
  if (message.deleted) {
    // A gap that says so, rather than a message quietly missing from the
    // middle of a conversation.
    return <Text style={[styles.gone, { color: t.dim }]}>Message deleted</Text>;
  }

  /*
   * A reaction, which is a line rather than a message.
   *
   * Below the hooks for the reason the tombstone above is — a row that
   * returns early before them is a render with fewer hooks than the last one,
   * and React refuses it outright.
   *
   * One centred line in the thread's own quiet colour: it belongs to the
   * conversation and is not a turn in it, and a reaction drawn as a bubble
   * with an emoji in it reads as somebody having said an emoji. No bubble and
   * no face — and centred whichever form it takes, including the one with the
   * photograph in it. That row was left-aligned in the column with the
   * comments, which put a thing nobody said on the same edge as the things
   * people did say; down the middle it reads as what it is, an aside in the
   * conversation rather than a turn in it.
   *
   * One thing it does answer now: a long press on your own takes it back. See
   * `HeldSheet` — there is nothing here to edit and no row to tombstone, so
   * that is the only verb it offers.
   */
  if (message.emoji) {
    /*
     * On a board, with the photograph it happened to.
     *
     * "Ana reacted ❤️ to a photo" is a line about a picture that is not in
     * it: the board is the one place in the product where every reaction in
     * an album is read in order, and it was the one place that would not say
     * *which* one — so a row of them read as noise, and the person who left
     * one could not find their way back to what they had left it on.
     *
     * The photograph goes where a comment has its author's face. One left
     * edge down the column, and the thing the row is about in the slot that
     * says what a row is about: a comment is a person talking, a reaction is
     * a picture being answered. It opens that photograph, which is the same
     * tap the thumbnail above a comment already takes.
     *
     * The centred line stays for the cases with no picture to show: a group's
     * room, where nothing has a photograph behind it, and a board whose feed
     * no longer holds the one this was left on — just deleted, say, which is
     * a gap rather than a reason to draw nothing. `about` is the whole of the
     * question and the shape is not part of it: only a caller that hands over
     * a `photoOf` has pictures for these lines to be about.
     */
    const takeBack = mine && onUnreact ? onUnreact : undefined;
    const said = `${mine ? 'You' : message.author.name} reacted ${message.emoji}`;
    return (
      <>
        <Pressable
          onLongPress={takeBack ? open : undefined}
          delayLongPress={320}
          accessibilityRole={takeBack ? 'button' : 'text'}
          accessibilityActions={takeBack ? [{ name: 'longpress', label: 'Remove' }] : undefined}
          onAccessibilityAction={
            takeBack
              ? (e) => {
                  if (e.nativeEvent.actionName === 'longpress') open();
                }
              : undefined
          }
        >
          {about ? (
            <View style={styles.reactedRow}>
              <Pressable
                onPress={() => onOpenPhoto?.(about.id)}
                disabled={!onOpenPhoto}
                accessibilityRole={onOpenPhoto ? 'button' : 'image'}
                accessibilityLabel={`${said}. The photograph it is on`}
                style={({ pressed }) => [
                  styles.reactedShot,
                  { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Image
                  source={{ uri: about.src }}
                  style={styles.reactedShotImage}
                  contentFit="cover"
                  transition={120}
                />
              </Pressable>
              <Text style={[styles.reactedText, { color: t.dim }]} numberOfLines={1}>
                <Text style={[styles.metaName, { color: t.fg }]}>
                  {mine ? 'You' : message.author.name}
                </Text>
                {' reacted '}
                {message.emoji}
              </Text>
            </View>
          ) : (
            <Text style={[styles.reacted, { color: t.dim }]} numberOfLines={1}>
              {said}
              {message.photoId ? ' to a photo' : ''}
            </Text>
          )}
        </Pressable>

        {held && (
          <HeldSheet
            t={t}
            /* Nothing to react to: a reaction is not a turn somebody can
               answer, and a row of emoji over one would offer to react to a
               reaction. */
            reactions={false}
            onReact={() => {}}
            onMore={() => {}}
            onEdit={null}
            onDelete={takeBack ?? null}
            deleteLabel="Remove my reaction"
            deleteNote="The line goes with it."
            onClose={() => setHeld(false)}
          />
        )}
      </>
    );
  }

  return (
    <View style={[styles.row, sided && styles.rowMine]}>
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

      <View style={[styles.said, sided && styles.saidMine]}>
        {/* The name in `fg` whoever wrote it, "You" included.
            A board has no sides, so the name is the whole of the answer to
            whose comment this is and it has to be set like everybody else's.
            One rule rather than one per shape: a chat had drawn its own as
            unweighted "You" because the side of the screen was doing that
            work, and giving it the same weight as the others costs it
            nothing — the bubble and the mirrored row still say whose it is. */}
        <Text style={[styles.meta, { color: t.dim }]} numberOfLines={1}>
          <Text style={[styles.metaName, { color: t.fg }]}>
            {mine ? 'You' : message.author.name}
          </Text>
          {' '}
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
            /*
              Long press rather than a glyph on every message: three dots
              beside each one is a permanent invitation, and on this width it
              competes with the name and the time for one line. It is how
              every verb a row has is reached now — react, edit, delete — and
              not only your own, which is what took the `+` off the pills.

              `delayLongPress` is shortened from the 500ms default. This is
              the only way to reach any of them, and half a second of holding
              still on a scrolling list is long enough that people let go
              first and conclude there is nothing there.
            */
            onLongPress={holdable ? open : undefined}
            delayLongPress={320}
            accessibilityRole={holdable ? 'button' : 'text'}
            /*
              And a second way to the same sheet, for somebody who cannot hold
              a finger still. A long press is invisible to a screen reader and
              impossible for some people to perform; the actions rotor is where
              iOS puts the alternative.
            */
            accessibilityActions={
              holdable ? [{ name: 'longpress', label: mine ? 'React, edit or delete' : 'React' }] : undefined
            }
            onAccessibilityAction={
              holdable
                ? (e) => {
                    if (e.nativeEvent.actionName === 'longpress') open();
                  }
                : undefined
            }
          >
            {/*
              The photograph this was said about, where it was said about one.
              *
              * A comment written under a picture is a line in this same board
              * carrying a `photo_id` — one thread, two ways in. This pane drew
              * the line and dropped the picture, so "look at her face in this
              * one" arrived on the board with no *this one* in it: the same
              * sentence meant two different things depending on where you
              * happened to read it, and on the board it meant nothing.
              *
              * Small, and above the words rather than beside them. It is the
              * subject of the sentence under it, not an illustration of it —
              * and a thumbnail large enough to look at would make the board a
              * second copy of the album.
              */}
            {about && (
              <Pressable
                onPress={() => onOpenPhoto?.(about.id)}
                disabled={!onOpenPhoto}
                accessibilityRole={onOpenPhoto ? 'button' : 'image'}
                accessibilityLabel="The photograph this is about"
                style={({ pressed }) => [
                  styles.about,
                  sided && styles.aboutMine,
                  { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Image
                  source={{ uri: about.src }}
                  style={styles.aboutShot}
                  contentFit="cover"
                  transition={120}
                />
              </Pressable>
            )}

            {/*
              The words on the page, in both rooms and whoever wrote them.

              Yours used to sit in a fill of the accent in a chat. The fill is
              what a messenger uses to say who is speaking, and the side of
              the screen already says it — which is why the board could drop
              the fill and keep the side and lose nothing. A group's room is
              the same reading problem: a column of solid blocks is read as
              traffic, and what is actually in it is people talking about an
              evening, at the length people write when they are not being
              charged a bubble for it.

              So one treatment, and `@ana` goes back to the accent in every
              message rather than being marked by weight inside a fill it can
              no longer be coloured against.
            */}
            <Text style={[styles.bodyText, { color: t.fg }]}>
              {withMentions(message.body, { color: t.accent })}
            </Text>
          </Pressable>
        )}

        {/*
          What the room has said back, and only that.

          The `+` that used to sit on the end of this row is gone. It was a
          bordered control under every comment in the thread offering to react
          to a sentence nobody had reacted to — a permanent invitation, drawn
          once per row, competing with the pills that are somebody's actual
          answer. Reacting is what holding the comment is for now, which is
          also how a reaction reaches a comment nobody has answered yet.

          So a row of pills exists only where there are pills: existing
          reactions, tappable to join or leave one. A room with no reactions
          at all — a group's, for now — simply never has any.
        */}
        {message.reactions.length > 0 && (
          <View style={[styles.chips, sided && styles.chipsMine]}>
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
          </View>
        )}
      </View>

      {held && (
        <HeldSheet
          t={t}
          /* Only where reacting is a thing this room does and this reader
             may: a group's messages have no reactions yet, and a row of
             emoji that does nothing is worse than no row. */
          reactions={canPost && canReact}
          onReact={(emoji) => {
            setHeld(false);
            onReact(emoji);
          }}
          onMore={() => {
            setHeld(false);
            setMore(true);
          }}
          onEdit={mine ? () => setEditing(message.body) : null}
          onDelete={mine ? onDelete : null}
          deleteLabel="Delete this comment"
          deleteNote="It leaves a gap saying it was deleted."
          onClose={() => setHeld(false)}
        />
      )}

      {/*
        And the rest of them, which is the picker the photo viewer opens.

        Ours rather than the system's, for the reason that file gives at
        length: there is no way to ask a phone for its emoji panel
        specifically, and a grid of our own can only produce emoji.
      */}
      {more && (
        <EmojiPicker
          t={t}
          onClose={() => setMore(false)}
          onPick={(emoji) => {
            setMore(false);
            onReact(emoji);
          }}
        />
      )}
    </View>
  );
}

/**
 * What a held row offers.
 *
 * Two parts, and the order is the argument: the reactions first, because
 * answering something is what somebody holding a comment usually means, and
 * the verbs that change it underneath — where a destructive one is reached
 * deliberately rather than landed on.
 *
 * It replaced an `Alert` with Edit and Delete in it. An alert is the right
 * shape for a question and the wrong one for a row of emoji, and it could
 * only ever be raised on your own rows, which left reacting to somebody
 * else's comment to a `+` pill drawn under every comment in the thread.
 *
 * A sheet rather than a popover over the row: a popover has to be placed, and
 * placing it means measuring a row inside an inverted list that may be two
 * pixels from the bottom of the screen. The sheet is always in the same place,
 * which is also the place the phone's own sheets are.
 */
function HeldSheet({
  t,
  reactions,
  onReact,
  onMore,
  onEdit,
  onDelete,
  deleteLabel,
  deleteNote,
  onClose,
}: {
  t: GroupTheme;
  /** Whether to offer the emoji at all. */
  reactions: boolean;
  onReact: (emoji: string) => void;
  /** The full picker, for the ones the row of six does not have. */
  onMore: () => void;
  /** Null where there is nothing to edit — somebody else's, or a reaction. */
  onEdit: (() => void) | null;
  /** Null where it is not yours to remove. */
  onDelete: (() => void) | null;
  deleteLabel: string;
  /** What removing it actually does, beside the button that does it. */
  deleteNote: string;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      {/*
        The same shell the emoji picker and the photo viewer's sheet use: a
        dim that is a *sibling* under the panel rather than its parent, so
        nothing above can claim a touch before the panel's own controls get
        it. Pressing it is the way out, which is how every sheet on this phone
        closes — a Cancel row would be a third thing to read.
      */}
      <View style={styles.heldShell}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />

        <View style={[styles.heldSheet, { backgroundColor: t.bg }]}>
          <View style={styles.heldGrip} />
          {reactions && (
            <View style={styles.heldEmoji}>
              {REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => onReact(emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                  style={({ pressed }) => [styles.heldEmojiOne, pressed && { opacity: 0.5 }]}
                >
                  <Text style={styles.heldEmojiText}>{emoji}</Text>
                </Pressable>
              ))}
              {/* The `+` at the end of the six, where it was at the end of the
                  pills: the same promise in the place it is now useful. */}
              <Pressable
                onPress={onMore}
                accessibilityRole="button"
                accessibilityLabel="More emoji"
                style={({ pressed }) => [
                  styles.heldMore,
                  { borderColor: t.line },
                  pressed && { opacity: 0.5 },
                ]}
              >
                <Text style={[styles.heldMoreText, { color: t.dim }]}>+</Text>
              </Pressable>
            </View>
          )}

          {reactions && (onEdit || onDelete) && (
            <View style={[styles.heldRule, { backgroundColor: t.line }]} />
          )}

          {onEdit && (
            <Pressable
              onPress={() => {
                onClose();
                onEdit();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.heldDo, pressed && { opacity: 0.5 }]}
            >
              <Text style={[styles.heldDoText, { color: t.fg }]}>Edit</Text>
            </Pressable>
          )}

          {onDelete && (
            <Pressable
              onPress={() => {
                onClose();
                onDelete();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.heldDo, pressed && { opacity: 0.5 }]}
            >
              <Text style={[styles.heldDoText, { color: t.warn }]}>{deleteLabel}</Text>
              {/* The consequence beside the button rather than in a second
                  panel after it. One sheet, and the thing worth knowing is in
                  front of the decision. */}
              <Text style={[styles.heldNote, { color: t.dim }]}>{deleteNote}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Who is in the event, and what they have put in.
 *
 * The third pane, and the one that answers "who else can see this photograph
 * of me" — a question the people in a room are entitled to an answer to. The
 * server already computes this roster for the web's People tab; this draws it.
 */
export function People({
  roster,
  t,
  /**
   * Whether this reader administers the album — the only one who may hand the
   * camera over.
   *
   * Promotion is `administer`-only on the server, so the set of people who can
   * add cannot grow without the album's owner. That is the property that makes
   * "Hosts" safe to offer as a contribute setting at all, and drawing the
   * control for anybody else would be the client promising what the server
   * refuses.
   */
  canAdminister = false,
  /** Only asked about on an album that is actually set to `host`. */
  hosted = false,
  onSetHost,
}: {
  roster: Roster[];
  t: GroupTheme;
  canAdminister?: boolean;
  hosted?: boolean;
  onSetHost?: (actorId: string, host: boolean) => void;
}) {
  return (
    <FlatList
      data={roster}
      keyExtractor={(person, i) => person.actorId ?? `${person.name}-${i}`}
      contentContainerStyle={styles.people}
      renderItem={({ item }) => {
        const lens = lensFor(item.actorId ?? item.name);
        /*
         * The toggle, and the three things that have to be true for it.
         *
         * Somebody who is in the album — an open invitation has no participant
         * row and therefore no role to set. Not the creator, who is a host by
         * being the creator and whose row the server refuses to write. And
         * only where the setting means anything: on `everyone` they can
         * already add, and on `creator` the whole point is that there is no
         * set to join, so a "Make a host" beside every name would be offering
         * a promotion into a group of one.
         */
        const promotable =
          canAdminister &&
          hosted &&
          onSetHost != null &&
          item.actorId != null &&
          item.role !== 'invited' &&
          item.role !== 'creator';
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
            {promotable ? (
              <Pressable
                onPress={() => onSetHost!(item.actorId!, !item.isHost)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ selected: item.isHost }}
                accessibilityLabel={
                  item.isHost
                    ? `${item.name} is a host. Press to take it back`
                    : `Make ${item.name} a host`
                }
                style={({ pressed }) => [
                  styles.personDo,
                  {
                    borderColor: item.isHost ? t.line : t.accent,
                    backgroundColor: item.isHost ? t.card : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.personDoText, { color: item.isHost ? t.dim : t.accent }]}
                >
                  {item.isHost ? 'Host' : 'Make a host'}
                </Text>
              </Pressable>
            ) : (
              <Text style={[styles.personHandle, { color: t.dim }]}>{standing(item)}</Text>
            )}
          </View>
        );
      }}
    />
  );
}

/**
 * The right-hand line: what this person is to the event, in three words.
 *
 * A description of what somebody has done here, not a rank — which is why a
 * host who has added nothing still reads as their photo count or as "Here".
 * The one exception is somebody the album's owner promoted on an album that
 * turns on it: there, being a host is the fact the row is about.
 */
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
     grows upwards from it.

     22 between rows, where the bubbles could live on 16: nothing is drawn
     around a turn in either room now, so the gap is the only thing separating
     one from the next. The site's board runs 18 against a narrower column. */
  list: { padding: 14, paddingHorizontal: 16, gap: 22 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  /* Quieter than the heading it replaced, and centred as one line.

     It was 20pt bold with a paragraph under it, which is a title — and a title
     is a thing a screen says about itself. This is a nudge, so it is set at
     the weight of the rest of the furniture and left to be read once. */
  emptyTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  /* Your own, mirrored — the face goes with it. A thread where one person has
     no face reads as a system message rather than as somebody talking, and a
     block hanging off the right with its avatar still on the left is neither
     side. */
  rowMine: { flexDirection: 'row-reverse' },
  /* A pill at the end of the row, in the shape the rest of the product uses
     for "one thing you can do about this". Bordered rather than filled: it is
     beside a name, and a solid accent block next to somebody's face reads as
     the row being about the button. */
  personDo: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  personDoText: { fontSize: 13, fontWeight: '600' },
  face: { width: 32, height: 32, borderRadius: 16 },
  faceBlank: { alignItems: 'center', justifyContent: 'center' },
  faceLetter: { fontSize: 13, fontWeight: '700' },
  said: { flex: 1, minWidth: 0, gap: 2 },
  /* The photograph a comment is about: a thumbnail the size of two lines of
     the text under it, so the row still reads as a sentence with a subject
     rather than as a picture with a caption. Aligned with whichever edge the
     message itself is on. */
  about: { borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  aboutMine: { alignSelf: 'flex-end' },
  aboutShot: { width: 52, height: 52 },
  /*
   * The block hangs from the right; its lines do not turn round with it.
   *
   * `alignItems` and not `textAlign`. A short comment shrinks to its words
   * and sits against the right edge, which is the whole of what a side is
   * for; a comment that wraps keeps its lines starting at one left edge,
   * because right-aligned prose over three lines is read a word at a time
   * while the eye hunts for where each one begins. Three words in a bubble
   * can take it and a paragraph cannot.
   */
  saidMine: { alignItems: 'flex-end' },
  meta: { fontSize: 12.5 },
  metaName: { fontWeight: '700' },
  bodyText: { fontSize: 15, lineHeight: 21 },
  /* Under the words, on the same edge the block hangs from — what somebody
     said and what the room said back are one thing to read. */
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chipsMine: { justifyContent: 'flex-end' },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  chipText: { fontSize: 13 },
  /*
   * What a held row opens: a sheet at the foot of the screen.
   *
   * The scrim takes the rest of it and closes on a press, which is how every
   * sheet on this phone closes and why there is no Cancel row to read.
   */
  heldShell: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  heldSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 34 },
  /* The handle every sheet in this product has, in the colour the emoji
     picker's is: it reads as something that came up and can go back down. */
  heldGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
  /* The six, spread across the width rather than bunched at one end: the row
     is a set of equal choices and reads as one when it is spaced as one. */
  heldEmoji: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  heldEmojiOne: { paddingVertical: 6, paddingHorizontal: 4 },
  /* Large, because this is a target on a sheet rather than a label on a pill
     — and an emoji at 26 is still the thing you are pressing. */
  heldEmojiText: { fontSize: 26 },
  /* The `+` as an outline beside them: it is the one item in the row that is
     not itself an answer, so it is drawn as a control and not as an emoji. */
  heldMore: { borderWidth: 1, borderRadius: 999, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  heldMoreText: { fontSize: 19, fontWeight: '600', lineHeight: 22 },
  heldRule: { height: 1, marginTop: 10, marginBottom: 2 },
  heldDo: { paddingVertical: 12, paddingHorizontal: 18, gap: 2 },
  heldDoText: { fontSize: 16, fontWeight: '600' },
  heldNote: { fontSize: 12.5, lineHeight: 17 },
  /*
   * A reaction's line: centred, quiet, and the width of the thread.
   *
   * Centred because it is about the conversation rather than a turn in it —
   * the same place a date separator would sit, and for the same reason.
   */
  reacted: { textAlign: 'center', fontSize: 12.5, lineHeight: 18, paddingVertical: 2 },
  /*
   * A reaction on a board: the photograph, and the line beside it, centred.
   *
   * 32 and the same 10-point gap as `row`. Square at 8 rather than round at
   * 16 — that slot holds a person in every other row and a picture in this
   * one, and the corner is the difference the eye reads before the content.
   *
   * Centred rather than run along the left edge with the comments, which is
   * where this started. It put a thing nobody said on the same edge as the
   * things people did say, and a run of them read as a column of comments
   * with no words in them. Down the middle it is what it is: an aside in the
   * conversation, in the same place the plain line has always been and the
   * same place a date separator would go.
   */
  reactedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  reactedShot: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  reactedShotImage: { width: '100%', height: '100%' },
  /*
   * `shrink` rather than `flex: 1`, now that the row is centred.
   *
   * Flexed to fill, the text took every point the photograph left and the
   * pair sat hard against both edges — which is not centred, it is
   * justified. Shrinking lets the two be as wide as they need and the row
   * centre what is actually there, while a long name still truncates against
   * the edge rather than pushing the emoji off it: the emoji is the half of
   * this line that carries the news.
   */
  reactedText: { flexShrink: 1, minWidth: 0, fontSize: 13.5, lineHeight: 19 },
  gone: { fontSize: 13, fontStyle: 'italic' },
  editing: { gap: 8 },
  editActions: { flexDirection: 'row', gap: 16 },
  editAction: { fontSize: 14, fontWeight: '600' },
  /* At the head of the composer with a hairline under it, which is where the
     site puts it: `.mention-list` is a wrapped row of pills with 6 of gap and
     8 of padding above its own bottom rule. */
  mentions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8, borderBottomWidth: 1 },
  mention: { borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  mentionText: { fontSize: 13, fontWeight: '600' },
  /* Pinned, with the home indicator's strip inside the padding rather than
     under the field. No hairline across the screen any more, in either room:
     the card has its own edge, and a rule behind it is the strip the card is
     there instead of. */
  composer: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 30, gap: 8 },
  /*
   * The site's composer, point for point: `.thread-composer` is a 1-point
   * border at radius 14 with 13 and 15 of padding and 8 between the field and
   * the actions under it. Restated rather than shared, like every other number
   * these two clients hold in common — there is no stylesheet between them —
   * and `thread-board.test.ts` is what keeps the pair honest.
   */
  card: { borderWidth: 1, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15, gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  /* Flexed, so the button stays at the right-hand edge whether or not there is
     anything to say to the left of it. */
  note: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  /*
   * Bare, because the card around it is the edge — no border and padding to
   * nothing, exactly as `.thread-field` is on the site. It was a bordered
   * pill in a chat, which is a second edge inside the first.
   *
   * `maxHeight` is the one number that does not match the site: 160 there,
   * 120 here, because a keyboard takes half of a phone and a box that grows
   * to 160 above one leaves two messages visible behind it.
   */
  field: { fontSize: 15, maxHeight: 120, padding: 0 },
  /*
   * Filled, and the site's own `.thread-actions button`: 9 and 16 of padding
   * at radius 10, the label at 14.
   *
   * It was an unfilled word in the accent on a board and a round ↑ disc in a
   * chat. The word's argument survives — a comment is posted where it already
   * is rather than sent away, and the label still says so — and neither
   * treatment does: this is the only control in the pane and the thing the
   * whole card is for, and the product fills that button everywhere else it
   * appears.
   */
  post: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10 },
  postText: { fontSize: 14, fontWeight: '600' },
  error: { fontSize: 13, lineHeight: 18 },
  people: { padding: 16, paddingBottom: 40 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1 },
  personFace: { width: 38, height: 38, borderRadius: 10 },
  personLetter: { fontSize: 14, fontWeight: '700' },
  personName: { fontSize: 15.5, fontWeight: '600' },
  personHandle: { fontSize: 13 },
});
