/**
 * Making an event — design §3 screen 1, and §7.3's window.
 *
 * Three fields' worth of screen, and one of them matters more than the other
 * two: the window. It is the only input auto-selection gets that a human
 * chose, and until this screen existed no client sent it at all — see
 * `when.ts`. Everything else here is in service of asking that question at the
 * one moment someone can answer it accurately, which is while they are
 * standing at the thing.
 *
 * After creating, the screen becomes the share step rather than dumping the
 * host back into an empty grid. The event is worth nothing until the link
 * reaches the group chat, and the moment the host is most likely to send it is
 * the second after they made it.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api } from './api';
import type { GroupTheme } from './Groups';
import { WHEN_OPTIONS, eventDateFor, windowFor, type WindowId } from '@parea/autoselect';

export type CreatedEvent = {
  id: string;
  name: string;
  linkToken: string;
  startsAt: string | null;
  endsAt: string | null;
};

export function CreateEvent({
  api,
  webBase,
  groupId,
  groupName,
  t,
  onCancel,
  onCreated,
  Button,
}: {
  api: Api;
  /** Where links live, for the message that gets shared. */
  webBase: string;
  groupId?: string;
  groupName?: string;
  t: GroupTheme;
  onCancel: () => void;
  onCreated: (event: CreatedEvent) => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [name, setName] = useState('');
  const [when, setWhen] = useState<WindowId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{
    event: CreatedEvent;
    url: string;
    code: string | null;
  } | null>(null);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || when === null) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const window = windowFor(when, now);
      const created = await api.createEvent({
        name: trimmed,
        groupId,
        eventDate: eventDateFor(when, now),
        startsAt: window?.startsAt ?? null,
        endsAt: window?.endsAt ?? null,
      });
      setMade({
        event: {
          id: created.id,
          name: created.name,
          linkToken: created.linkToken,
          startsAt: window?.startsAt ?? null,
          endsAt: window?.endsAt ?? null,
        },
        url: `${webBase}/e/${created.linkToken}`,
        code: created.code,
      });
    } catch {
      setError('Could not make the event. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, groupId, name, webBase, when]);

  if (made) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.h1, { color: t.fg }]}>{made.event.name}</Text>
        <Text style={[styles.body, { color: t.dim }]}>
          Send this to everyone who was there. Anyone with it can add photos —
          no account, no app.
        </Text>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.mono, { color: t.fg }]}>{made.url}</Text>
          <Button
            label="Share the link"
            primary
            t={t}
            onPress={() => {
              // The system sheet, because the destination is a group chat and
              // the OS already knows which one people use.
              void Share.share({ message: made.url });
            }}
          />
        </View>

        {made.code && (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
            <Text style={[styles.label, { color: t.fg }]}>Or say the code out loud</Text>
            <Text style={[styles.code, { color: t.accent }]}>{made.code}</Text>
            <Text style={[styles.small, { color: t.dim }]}>
              For the person across the room whose phone you are not holding.
            </Text>
          </View>
        )}

        <Button label="Open it" t={t} onPress={() => onCreated(made.event)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onCancel}>
        <Text style={[styles.body, { color: t.accent }]}>‹ Cancel</Text>
      </Pressable>

      <Text style={[styles.h1, { color: t.fg }]}>
        {groupName ? `New event in ${groupName}` : 'Start an event'}
      </Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>What was it?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Sarah's birthday"
          placeholderTextColor={t.dim}
          autoFocus
          maxLength={120}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>When?</Text>
        {/*
          Said plainly, because a date question with no stated reason gets a
          careless answer — and a careless one here is worse than none. §7.3:
          a wrong window pre-selects the wrong photos.
        */}
        <Text style={[styles.small, { color: t.dim }]}>
          This is what lets the app find everyone&rsquo;s photos from the right
          hours later, instead of asking them to scroll.
        </Text>
        {WHEN_OPTIONS.map((option) => {
          const chosen = when === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setWhen(option.id)}
              style={[
                styles.choice,
                { borderColor: chosen ? t.accent : t.line },
                chosen && { backgroundColor: t.bg },
              ]}
            >
              <Text style={[styles.body, { color: chosen ? t.accent : t.fg }]}>
                {option.label}
              </Text>
              <Text style={[styles.small, { color: t.dim }]}>{option.hint}</Text>
            </Pressable>
          );
        })}
      </View>

      {error && <Text style={[styles.body, { color: t.dim }]}>{error}</Text>}

      {/*
        Nothing is pre-selected, so the button waits for an answer rather than
        letting one be skipped past. "Not sure yet" is one of the answers.
      */}
      <Button
        label={busy ? 'Making it…' : 'Make the event'}
        onPress={create}
        disabled={busy || !name.trim() || when === null}
        t={t}
        primary
      />
      {busy && <ActivityIndicator color={t.accent} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 72, gap: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  mono: { fontSize: 15, fontFamily: 'Courier' },
  code: { fontSize: 24, fontWeight: '700', letterSpacing: 1 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  choice: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 2 },
});
