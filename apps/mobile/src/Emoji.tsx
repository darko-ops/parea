/**
 * An emoji picker, because the system will not lend us its one.
 *
 * The first version of this reached for the keyboard: an invisible `TextInput`
 * that took focus, and whatever somebody typed became the reaction. It works,
 * and it opens *a* keyboard — the last panel they used, which is usually but
 * not always the emoji one. There is no `keyboardType` for emoji on iOS and no
 * public API to select that panel; the private one is a rejection.
 *
 * So the choice was a keyboard that is sometimes letters, or a grid of our own.
 * A grid it is: it can only produce emoji, which is the whole requirement, and
 * it never opens a text field over somebody's photograph.
 *
 * ## What it costs, honestly
 *
 * Their recents. The system keyboard puts the emoji somebody actually uses in
 * front of them and this cannot see that list — nothing can, it belongs to the
 * keyboard. So the order here is the best fixed guess: the ones people react
 * with first, then the rest by category.
 *
 * And completeness. This is a few hundred emoji, not the several thousand
 * Unicode defines — no skin tones, no flags, no professions. A complete set
 * means a dataset that has to be updated with Unicode, and the tail of that
 * list is emoji nobody has ever reacted to a photograph with. The server takes
 * any single emoji, so nothing here is a ceiling on what can be stored: if this
 * list ever needs to be the whole set, it is this file that changes and not the
 * shape of anything.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GroupTheme } from './Groups';

/**
 * The emoji, by section, in the order somebody scans them.
 *
 * `Reactions` first and deliberately short: it is the six the picker used to
 * offer outright, which were chosen because they are what people react to
 * photographs with. Keeping them at the top means the common case is still one
 * scroll-free tap, which is what the old column bought and the only thing worth
 * keeping from it.
 */
const SECTIONS: { name: string; emoji: string[] }[] = [
  {
    name: 'Reactions',
    emoji: ['❤️', '😂', '🔥', '👏', '😮', '🙏', '😍', '🥹', '🤩', '💯', '🙌', '✨'],
  },
  {
    name: 'Faces',
    emoji: [
      '😀', '😃', '😄', '😁', '😅', '🤣', '🙂', '🙃', '😉', '😊', '😇', '🥰',
      '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭',
      '🤫', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥',
      '😌', '😔', '😪', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😵',
      '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯',
      '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖',
      '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '🤬', '💀', '👻', '👽',
    ],
  },
  {
    name: 'People',
    emoji: [
      '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘',
      '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '🫶',
      '🤝', '💪', '🦾', '🧠', '👀', '👁️', '👣', '💃', '🕺', '👯', '🧘', '🏃',
      '🚶', '🧑‍🤝‍🧑', '👩‍❤️‍👨', '👨‍👩‍👧', '🐣', '🫂',
    ],
  },
  {
    name: 'Nature',
    emoji: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮',
      '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦆', '🦉', '🦇', '🐺', '🐗', '🐴',
      '🦄', '🐝', '🦋', '🐌', '🐞', '🐢', '🐍', '🐙', '🦑', '🦐', '🦀', '🐡',
      '🐠', '🐟', '🐬', '🐳', '🦈', '🐊', '🐅', '🦓', '🦍', '🐘', '🦒', '🐄',
      '🌵', '🌲', '🌳', '🌴', '🌱', '🍀', '🍁', '🍂', '🌷', '🌹', '🌺', '🌸',
      '🌼', '🌻', '🌞', '🌝', '🌚', '🌙', '⭐', '🌟', '💫', '☄️', '🌈', '☀️',
      '⛅', '☁️', '🌧️', '⛈️', '❄️', '⛄', '🔥', '💧', '🌊',
    ],
  },
  {
    name: 'Food',
    emoji: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒',
      '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️',
      '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨',
      '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪',
      '🌮', '🌯', '🥗', '🥘', '🍝', '🍜', '🍲', '🍣', '🍱', '🥟', '🍤', '🍙',
      '🍚', '🍥', '🥮', '🍢', '🍡', '🍦', '🍰', '🎂', '🧁', '🥧', '🍫', '🍬',
      '🍭', '🍩', '🍪', '☕', '🍵', '🧃', '🥤', '🍺', '🍻', '🥂', '🍷', '🥃',
      '🍸', '🍹', '🧉', '🍾',
    ],
  },
  {
    name: 'Doing',
    emoji: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥅', '⛳',
      '🏹', '🎣', '🥊', '🥋', '🛹', '🛼', '🛷', '⛸️', '🎿', '⛷️', '🏂', '🏋️',
      '🤸', '🤾', '🏊', '🏄', '🚣', '🧗', '🚴', '🚵', '🎪', '🎭', '🎨', '🎬',
      '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️',
      '🎯', '🎳', '🎮', '🧩', '🎊', '🎉', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉',
    ],
  },
  {
    name: 'Places',
    emoji: [
      '🚗', '🚕', '🚙', '🚌', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚲',
      '🛴', '🏍️', '✈️', '🚀', '🛸', '🚁', '⛵', '🚤', '🛳️', '⚓', '🚂', '🚆',
      '🚇', '🗺️', '🏔️', '⛰️', '🌋', '🏕️', '🏖️', '🏝️', '🏜️', '🏞️', '🏟️', '🏛️',
      '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏨', '🏪', '🏫', '⛪', '🕌', '🛕',
      '🗼', '🗽', '🗿', '⛲', '🌁', '🌃', '🏙️', '🌄', '🌅', '🌆', '🌇', '🌉',
    ],
  },
  {
    name: 'Things',
    emoji: [
      '⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '📸', '📹', '🎥', '📽️', '📞',
      '📺', '📻', '🧭', '⏰', '⏳', '🔋', '💡', '🔦', '🕯️', '🧯', '💸', '💰',
      '💳', '💎', '⚖️', '🔧', '🔨', '🪛', '🔩', '🧲', '🔫', '💊', '🩹', '🩺',
      '🚪', '🛏️', '🛋️', '🚽', '🚿', '🛁', '🧴', '🧷', '🧹', '🧺', '🧻', '🔑',
      '🗝️', '🔒', '🔓', '📦', '📫', '📮', '📝', '✏️', '📚', '📖', '📰', '🗞️',
      '🔍', '🔬', '🔭', '📡',
    ],
  },
  {
    name: 'Symbols',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕',
      '💞', '💓', '💗', '💖', '💘', '💝', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️',
      '🔯', '☯️', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑',
      '♒', '♓', '⛎', '🆗', '🆒', '🆕', '🔝', '✅', '❌', '❗', '❓', '💤',
      '💢', '💥', '💦', '💨', '🕳️', '💬', '👁️‍🗨️', '🗯️', '💭', '♻️', '⚠️', '🚫',
    ],
  },
];

/** Per row. Seven 44pt keys and their gaps fit a 390pt screen with margins. */
const COLUMNS = 7;

/**
 * How wide every section pill is.
 *
 * One number for all of them rather than each sized to its own word: `Food` was
 * two-thirds the width of `Reactions`, so the row read as a ragged set of
 * unrelated things and reflowed under a thumb as the selection moved along it.
 *
 * Set by the longest label at 13.5pt semibold with room either side. A section
 * named something longer than this is a change to this constant, not a row that
 * quietly starts clipping.
 */
const TAB = 96;

/**
 * How far down before the sheet goes, and how fast counts regardless.
 *
 * The same pair of numbers the photo viewer uses, and deliberately: two sheets
 * on the same screen that close at different thresholds are two gestures to
 * learn.
 */
const SWIPE = 80;
const FLING = 0.6;

export function EmojiPicker({
  t,
  onPick,
  onClose,
}: {
  t: GroupTheme;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState(0);
  const shown = SECTIONS[section]!;

  /**
   * Whether the grid is at its top.
   *
   * The whole of the swipe-to-close problem is here. A downward drag inside the
   * grid is a scroll, and a sheet that took every downward drag would make the
   * grid unscrollable — but a drag at the top of an already-scrolled-to-the-top
   * grid has nothing to scroll, which is exactly when somebody means "put this
   * away".
   *
   * A ref rather than state: it is read inside a `PanResponder` built once, and
   * as state it would rebuild the responder on every scroll frame.
   */
  const atTop = useRef(true);

  /*
   * Claimed on capture, so the gesture is taken before the `ScrollView` under it
   * sees the touch — and only ever when the grid has nothing left to give.
   * Vertical and downward only: sideways is the section row, and upward at the
   * top of a list is a rubber-band somebody expects to bounce.
   */
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_evt, g) =>
          atTop.current && g.dy > 6 && g.dy > Math.abs(g.dx),
        onPanResponderRelease: (_evt, g) => {
          if (g.dy > SWIPE || g.vy > FLING) onClose();
        },
      }),
    [onClose],
  );

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/*
        The same flat arrangement the album's sheet uses: the dim is a sibling
        under the panel rather than its parent, so nothing above the grid can
        claim a touch before the scroll view gets it.
      */}
      <View style={styles.shell}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />

        <View style={[styles.panel, { backgroundColor: t.bg }]} {...responder.panHandlers}>
          <View style={styles.grip} />

          {/*
            The sections as a row of words rather than a row of glyphs.

            Every emoji keyboard uses one representative emoji per category,
            which is a puzzle at 16 points: a peach means food and a ball means
            sport only once you already know. Words are wider and nobody has to
            learn them.
          */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {SECTIONS.map((s, i) => (
              <Pressable
                key={s.name}
                onPress={() => {
                  // A new section starts at the top, and the flag has to know:
                  // without this, switching after scrolling leaves the sheet
                  // refusing to close until somebody scrolls again.
                  atTop.current = true;
                  setSection(i);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: i === section }}
                style={[
                  styles.tab,
                  i === section && { backgroundColor: t.card, borderColor: t.line },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.tabText, { color: i === section ? t.fg : t.dim }]}
                >
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            contentContainerStyle={styles.grid}
            // Cheap, and the only thing the close gesture needs to know.
            scrollEventThrottle={32}
            onScroll={(e) => {
              atTop.current = e.nativeEvent.contentOffset.y <= 0;
            }}
          >
            {shown.emoji.map((emoji, i) => (
              <Pressable
                // The same emoji appears in two sections on purpose — a heart is
                // a reaction and a symbol — so the index is part of the key.
                key={`${emoji}-${i}`}
                onPress={() => onPick(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
                style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
              >
                <Text style={styles.keyText}>{emoji}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  panel: {
    height: '58%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  grip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
  tabs: { gap: 6, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' },
  /*
   * Every pill the same size, which is not what padding gives you.
   *
   * Sized to the word, "Food" was two-thirds the width of "Reactions" and the
   * row read as a ragged set of unrelated things rather than as one control
   * with a selected item. Worse, the selected pill changed width as you moved
   * along the row, so the row reflowed under your thumb.
   *
   * A fixed width and a fixed height, with the label centred in it. `TAB` is
   * the longest label at this size plus room either side — the number exists so
   * that adding a section named something long is a change to one constant
   * rather than a row that silently starts clipping.
   */
  tab: {
    width: TAB,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Centred and never wrapped: a label on two lines inside a 32pt pill is a
     label with its second half cut off. */
  tabText: { fontSize: 13.5, fontWeight: '600', textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingBottom: 40,
  },
  /* A seventh of the row, square, so the grid is even without measuring. */
  key: { width: `${100 / COLUMNS}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 28 },
});
