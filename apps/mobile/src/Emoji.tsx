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

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

        <View style={[styles.panel, { backgroundColor: t.bg }]}>
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
                onPress={() => setSection(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: i === section }}
                style={[
                  styles.tab,
                  i === section && { backgroundColor: t.card, borderColor: t.line },
                ]}
              >
                <Text
                  style={[styles.tabText, { color: i === section ? t.fg : t.dim }]}
                >
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.grid}>
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
  tabs: { gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: { fontSize: 13.5, fontWeight: '600' },
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
