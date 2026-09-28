/**
 * What the `+` makes: a roll, a group, or a moment.
 *
 * Two tabs reach for this — Events and You — and they must offer the same two
 * things in the same words. Written twice it would be two sheets that agree
 * today and disagree the first time somebody rewrites a line, which is the kind
 * of drift nobody sees because nobody opens both in the same minute.
 *
 * A sheet rather than a menu pinned under the corner. The two things it makes
 * are not the same size — an album is an evening, a group is a room that
 * outlives one — and each needs a line saying which is which, which a row of
 * two words cannot carry.
 *
 * It creates nothing itself. Both choices hand off to the screen that already
 * knows how, so there is still exactly one place each thing is made.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { GroupTheme } from './Groups';

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

export function StartSomething({
  t,
  Button,
  onClose,
  onAlbum,
  onGroup,
  onMoment,
}: {
  t: GroupTheme;
  Button: ButtonComponent;
  onClose: () => void;
  /** The create screen, which is the only place an album is made. */
  onAlbum: () => void;
  /**
   * The Groups tab, with its form open.
   *
   * Never a form drawn here: the one on that tab arrives with the people this
   * person keeps ending up in events with, which is the whole argument for
   * making a group rather than an empty room to fill.
   */
  onGroup: () => void;
  /**
   * One photograph off the camera roll, put up as a moment.
   *
   * The caller owns the picker and the upload, because it owns the row the
   * moment lands in and has to refresh it.
   */
  onMoment: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
          <View style={styles.inner}>
            <Text style={[styles.title, { color: t.fg }]}>New</Text>

            {(
              [
                ['Roll', 'A shared place for photos with your people.', onAlbum],
                ['Group', 'Your people, together for whatever comes next.', onGroup],
                ['Moment', 'Put one photo front and center for your people.', onMoment],
              ] as const
            ).map(([name, why, go]) => (
              <Pressable
                key={name}
                onPress={() => {
                  onClose();
                  go();
                }}
                accessibilityRole="button"
                accessibilityLabel={`${name}. ${why}`}
                style={({ pressed }) => [
                  styles.choice,
                  { borderColor: t.line, backgroundColor: t.card, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.choiceName, { color: t.fg }]}>{name}</Text>
                <Text style={[styles.choiceWhy, { color: t.dim }]}>{why}</Text>
              </Pressable>
            ))}

            <Button label="Cancel" t={t} onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  panel: { maxHeight: '90%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  inner: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  /* One of the choices: what it is, and what it is for. */
  choice: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 4 },
  choiceName: { fontSize: 16, fontWeight: '600' },
  choiceWhy: { fontSize: 13.5, lineHeight: 19 },
});
