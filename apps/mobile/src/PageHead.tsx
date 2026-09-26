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

import { StyleSheet, Text, View } from 'react-native';

import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { ROUND, RoundButton } from './RoundButton';
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

/**
 * The door to Lately, in the trailing corner of every tab that has one.
 *
 * Here rather than on a tab of its own: three tabs is the whole of this app's
 * navigation, and a fourth carrying a list that is usually empty would cost a
 * permanent quarter of the tab bar. A disc in a head row costs nothing when
 * there is nothing.
 *
 * It lived on the Groups tab alone, which is where the asks happened to be
 * listed rather than where somebody would look for them — the one control in
 * the product that says *somebody is waiting on you* was behind a tab you had
 * to already be on. It is in the same corner of all three now.
 *
 * The badge is hidden at zero, as the web's is. A badge that draws "0" teaches
 * people that the number means nothing, and an empty circle is a claim that
 * something is there.
 *
 * ## Why there are two marks and not one
 *
 * The number is jobs — an invitation, a friend request, somebody at the door
 * of an event you run — and each one is a separate thing to do, so four is
 * worth distinguishing from one.
 *
 * Most of what this product sends a notification about is not a job. Somebody
 * commented on your photograph, tagged you in one, added thirty to an album
 * you were at: things that happened, which you may want to go and look at and
 * cannot answer. Counting those would turn the badge into a measure of volume,
 * and a number that only goes down when you look is a number that stops
 * meaning anything. So news gets the smaller claim — a dot, saying there is
 * something in there and nothing more.
 *
 * Without it the tray was silent for almost everything: the push arrived, the
 * banner went, and the one control in the app that points at Lately carried no
 * mark at all. Somebody who missed the banner had no way back except to open
 * the screen on the off-chance.
 *
 * The count wins when there is one. A job is the more urgent of the two, and
 * two marks on one disc is a disc nobody reads.
 */
export function Notifications({
  t,
  count,
  unread = false,
  onPress,
}: {
  t: GroupTheme;
  /** How many things are waiting on an answer. Zero draws no badge. */
  count: number;
  /** Whether anything has happened since the last look. Draws the dot. */
  unread?: boolean;
  onPress: () => void;
}) {
  return (
    <RoundButton
      t={t}
      onPress={onPress}
      accessibilityLabel={
        count > 0
          ? `Lately, ${count} waiting on you`
          : unread
            ? 'Lately, something new'
            : 'Lately'
      }
    >
      <Glyph name="tray" size={20} color={t.fg} />
      {count > 0 ? (
        <View style={[styles.badge, { backgroundColor: t.accent, borderColor: t.bg }]}>
          <Text style={[styles.badgeCount, { color: t.onAccent }]}>
            {/* Past this the number stops being readable at 11.5pt and stops
                being actionable anyway — "a lot" is the same instruction as
                "99". */}
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : unread ? (
        /* The same pill with nothing in it. Same fill and same ring, because
           it is the same badge making a smaller claim — a second colour here
           would read as a second kind of urgency. */
        <View style={[styles.badge, styles.dot, { backgroundColor: t.accent, borderColor: t.bg }]} />
      ) : null}
    </RoundButton>
  );
}

const styles = StyleSheet.create({
  /* As tall as a disc whether or not there is one, so a tab with no controls
     does not start its content higher up than a tab with two. */
  row: { flexDirection: 'row', alignItems: 'center', minHeight: ROUND },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trailing: { justifyContent: 'flex-end' },
  /* Over the disc's own edge, ringed in the page colour so it reads as sitting
     on top of the button rather than as part of it. */
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 19,
    height: 19,
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: { fontSize: 11.5, fontWeight: '700', lineHeight: 14 },
  /* Smaller than the pill and still ringed, so it reads as the same mark
     rather than as a stray dot that happens to be near the disc. */
  dot: { minWidth: 12, width: 12, height: 12, paddingHorizontal: 0, top: -1, right: -1 },
});
