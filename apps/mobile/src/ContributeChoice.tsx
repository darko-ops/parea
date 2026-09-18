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
 * Two lists rather than one with a relabelling pass, because the *order*
 * differs as well as the words and the order is the argument. On a public
 * album the ordinary answer is that everyone who turns up can add, so that
 * leads; on a private one the album is usually somebody's and the people in it
 * are the exception, so "Only me" leads. A single list would put the same
 * option first in both places and make one of them read as the default when it
 * is not.
 *
 * `everyone` is the same stored value under both labels. It has always
 * deferred to the other setting rather than restating it — "whoever the album
 * is open to" — and what changes is which word is true here: on a private
 * album the people who can see it are its members, and calling them "everyone"
 * was the one place this copy made somebody work out the composition for
 * themselves.
 *
 * `nobody` is on neither list any more. It was a way of ending an album that
 * people reached for by accident and could not find their way back out of,
 * since the setting that undoes it is the one they had just closed.
 *
 * The same two lists the web's own `ContributeChoice` draws, in the same
 * words: a phone and a browser describing one setting differently is two
 * products.
 */
const PUBLIC_OPTIONS: ContributeOption[] = [
  {
    value: 'everyone',
    label: 'Everyone',
    help: 'Anybody who opens the link can add to it. Adding always needs an account, so every photograph says who put it there.',
  },
  {
    value: 'creator',
    label: 'Only me',
    help: 'You add the photographs and everybody else comes to look. They can still say something and react — it is the pictures that are yours to put in.',
  },
  {
    value: 'host',
    label: 'Hosts',
    help: 'You and the people you make hosts. Anybody else in the album can ask to be one, and you decide — so the camera can be handed over without the album being.',
  },
];

const PRIVATE_OPTIONS: ContributeOption[] = [
  {
    value: 'creator',
    label: 'Only me',
    help: 'You add the photographs and everybody else comes to look. They can still say something and react — it is the pictures that are yours to put in.',
  },
  {
    value: 'everyone',
    label: 'Members',
    help: 'Everybody in the album can add to it — the people you added and the people you let in, and nobody else. Adding names who added, so every photograph says who put it there.',
  },
  {
    value: 'host',
    label: 'Hosts',
    help: 'You and the people you make hosts. Anybody else in the album can ask to be one, and you decide — so the camera can be handed over without the album being.',
  },
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

const styles = StyleSheet.create({
  /* The same shape the visibility pills are, and wrapping for the same reason:
     three labels do not always fit a phone's width in one line. */
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  pillText: { fontSize: 15 },
  pillTextOn: { fontWeight: '600' },
  spent: { opacity: 0.5 },
  help: { fontSize: 13, lineHeight: 18 },
});
