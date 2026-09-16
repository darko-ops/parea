/**
 * The product's name, in the same place on every tab.
 *
 * Each of the four used to open differently. Home had the wordmark between a
 * held-open slot and a `+`; Groups had "Your Parea" at 30 points beside two
 * discs; Find had "Find" above a search field; the profile had two discs and
 * nothing between them. Four screens, four ideas about what the top of a
 * screen is.
 *
 * Two of those were page titles, and a page title on a tab bar's own
 * destination is a line naming the thing you just pressed — the bar already
 * says where you are, in a picture nobody has to read. What was worth keeping
 * is the half of Home's row that is not a title: the name of the product,
 * which says whose app this is rather than which corner of it you are in.
 *
 * ## Why the sides are flexed rather than held open
 *
 * Home's row held a slot exactly the width of its `+` so the word would centre
 * on the screen rather than on what was left of it. That works for one control
 * and stops at two: Groups has an envelope *and* a `+`, and a single-disc slot
 * opposite them would push the word left by half a disc — close enough to read
 * as centred and not be, which is the version that looks like a mistake.
 *
 * Equal flex on both sides centres it whatever each side holds, with no caller
 * measuring anything. The word keeps its natural width in between, which is
 * also why it is given one: `Wordmark` is an SVG and cannot size itself to its
 * own content, so the default `100%` would make it fill a flex parent and
 * re-centre in that instead.
 */

import { StyleSheet, View } from 'react-native';

import { ROUND } from './RoundButton';
import { Wordmark } from './Wordmark';

/** The wordmark's drawn width, which decides how much the sides get. */
const WORD = 104;

export function PageHead({
  color,
  left,
  right,
}: {
  color: string;
  /** Controls in the leading corner. Nothing on most tabs. */
  left?: React.ReactNode;
  /** Controls in the trailing corner — one disc, two, or none. */
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>{left}</View>
      <Wordmark color={color} size={30} width={WORD} />
      <View style={[styles.side, styles.trailing]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* As tall as a disc whether or not there is one, so a tab with no controls
     does not start its content higher up than a tab with two. */
  row: { flexDirection: 'row', alignItems: 'center', minHeight: ROUND },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trailing: { justifyContent: 'flex-end' },
});
