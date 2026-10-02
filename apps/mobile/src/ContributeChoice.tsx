/**
 * Who can add photographs — three answers, in the two places it is asked.
 *
 * The same question the web asks with `ContributeChoice.tsx`, and the same
 * three answers in the same words: it is asked when an album is made and again
 * when one is managed, and a phone and a browser saying different things about
 * one setting is two products.
 *
 * It replaces a switch that was on or off. Two of these three were the same
 * value in that switch — on meant "whoever the album is open to" — and the
 * third could not be said at all. An evening where one person had the camera
 * and everybody else came to look is an ordinary thing to want, and the album
 * had to be either open to all of them or closed to everyone including the
 * person holding the camera.
 *
 * ## The copy says what happens, not what the setting is called
 *
 * The rule the visibility pills already follow. "Everyone" points back at the
 * other setting rather than restating it — the two compose, and the album's
 * answer to *who can see it* is what decides who "everyone" is. Saying it
 * twice is how the two come to disagree.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ContributePolicy } from './api';
import type { GroupTheme } from './Groups';

export type ContributeOption = {
  value: ContributePolicy;
  label: string;
  /** What happens to somebody looking at the album. */
  help: string;
};

/**
 * The three, in the order they are offered, per answer to "who can see it".
 *
 * The same order under both answers now, widest first: whoever the album is
 * open to, then its hosts, then just the person making it. It used to differ —
 * "Only me" led a private album — and that made the two lists read as two
 * questions when it is one question whose first answer changes its name.
 *
 * `everyone` is the same stored value under both labels. It has always
 * deferred to the other setting rather than restating it — "whoever the album
 * is open to" — and what changes is which word is true here: on a public album
 * that is anyone with the link, and on a private one it is its members.
 * Switching visibility keeps the value and relabels it.
 *
 * Each line is short enough to sit under its title in the create screen's
 * list, and says what happens rather than what the setting is called.
 *
 * `nobody` is on neither list any more. It was a way of ending an album that
 * people reached for by accident and could not find their way back out of,
 * since the setting that undoes it is the one they had just closed.
 *
 * The same two lists the web's own `ContributeChoice` draws, in the same
 * words: a phone and a browser describing one setting differently is two
 * products.
 */
const HOSTS: ContributeOption = {
  value: 'host',
  label: 'Hosts',
  help: 'You and the people you make hosts.',
};

const JUST_ME: ContributeOption = {
  value: 'creator',
  label: 'Just me',
  help: 'Everyone else can look.',
};

const PUBLIC_OPTIONS: ContributeOption[] = [
  {
    value: 'everyone',
    label: 'Anyone',
    help: 'Anyone with the link can add their photos.',
  },
  HOSTS,
  JUST_ME,
];

const PRIVATE_OPTIONS: ContributeOption[] = [
  {
    value: 'everyone',
    label: 'Members',
    help: 'Everyone in the roll can add their photos.',
  },
  HOSTS,
  JUST_ME,
];

export function contributeOptions(accessPolicy: string): ContributeOption[] {
  return accessPolicy === 'private' ? PRIVATE_OPTIONS : PUBLIC_OPTIONS;
}

export function ContributeChoice({
  value,
  onChange,
  t,
  /**
   * Who can see the album, which decides what this question's answers are
   * called and what order they come in.
   *
   * Passed in rather than read from anywhere, because on the create screen it
   * is a choice somebody is making two fields up and has not saved yet.
   */
  accessPolicy,
  disabled = false,
  /** Shown under the options where this is an album that already exists. */
  note,
}: {
  value: ContributePolicy;
  onChange: (next: ContributePolicy) => void;
  t: GroupTheme;
  accessPolicy: string;
  disabled?: boolean;
  note?: string;
}) {
  const options = contributeOptions(accessPolicy);
  const chosen = options.find((option) => option.value === value);

  return (
    <>
      <View style={styles.pills}>
        {options.map((option) => {
          const on = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              disabled={disabled}
              onPress={() => !on && onChange(option.value)}
              style={[
                styles.pill,
                on
                  ? { borderColor: t.accent, borderWidth: 1.5, backgroundColor: t.bg }
                  : { borderColor: t.line, backgroundColor: t.card },
                disabled && styles.spent,
              ]}
            >
              <Text
                style={[styles.pillText, on && styles.pillTextOn, { color: on ? t.accent : t.fg }]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.help, { color: t.dim }]}>{chosen?.help}</Text>
      {note && <Text style={[styles.help, { color: t.dim }]}>{note}</Text>}
    </>
  );
}

/**
 * The same three, as a list with a radio on each row — the create screen's
 * shape.
 *
 * A list rather than pills there because each answer carries its own line:
 * the pills say one help sentence for whichever is chosen, and a person
 * naming a roll should be able to read all three without tapping through
 * them. The manage screen keeps the pills, where the choice has been made
 * once already and is being changed.
 */
export function ContributeList({
  value,
  onChange,
  t,
  accessPolicy,
}: {
  value: ContributePolicy;
  onChange: (next: ContributePolicy) => void;
  t: GroupTheme;
  accessPolicy: string;
}) {
  return (
    <View style={[styles.list, { borderColor: t.line, backgroundColor: t.card }]}>
      {contributeOptions(accessPolicy).map((option, index) => {
        const on = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${option.label}. ${option.help}`}
            onPress={() => !on && onChange(option.value)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopWidth: 1, borderTopColor: t.line },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: t.fg }]}>{option.label}</Text>
              <Text style={[styles.help, { color: t.dim }]}>{option.help}</Text>
            </View>
            <View style={[styles.radio, { borderColor: on ? t.accent : t.line }]}>
              {on && <View style={[styles.radioDot, { backgroundColor: t.accent }]} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /* The same shape the visibility pills are, and wrapping for the same reason:
     three labels do not always fit a phone's width in one line. */
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  pillText: { fontSize: 15 },
  pillTextOn: { fontWeight: '600' },
  spent: { opacity: 0.5 },
  help: { fontSize: 13, lineHeight: 18 },
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
