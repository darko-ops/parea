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

export const CONTRIBUTE_OPTIONS: {
  value: ContributePolicy;
  label: string;
  /** What happens to somebody looking at the album. */
  help: string;
}[] = [
  {
    value: 'everyone',
    label: 'Everyone',
    help: 'Anyone who can see the album can add to it. Adding always needs an account, so every photograph says who put it there.',
  },
  {
    value: 'host',
    label: 'Only me',
    help: 'You add the photographs and everybody else comes to look. They can still say something and react — it is the pictures that are yours to put in.',
  },
  {
    value: 'nobody',
    label: 'Nobody',
    help: 'The album is finished. Nothing more goes in, including from you. The conversation stays open either way.',
  },
];

export function ContributeChoice({
  value,
  onChange,
  t,
  disabled = false,
  /** Shown under the options where this is an album that already exists. */
  note,
}: {
  value: ContributePolicy;
  onChange: (next: ContributePolicy) => void;
  t: GroupTheme;
  disabled?: boolean;
  note?: string;
}) {
  const chosen = CONTRIBUTE_OPTIONS.find((option) => option.value === value);

  return (
    <>
      <View style={styles.pills}>
        {CONTRIBUTE_OPTIONS.map((option) => {
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
