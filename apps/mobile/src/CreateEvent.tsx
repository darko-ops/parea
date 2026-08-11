/**
 * Making an event — design §3 screen 1, and §7.3's window.
 *
 * The window is the field that matters, and this screen no longer asks for it.
 * It used to: a radio list of Tonight / Last night / Today / Yesterday, turned
 * into a window by `when.ts`. That put the question to the wrong party. The
 * phone holds the answer already and holds it exactly — a night out is a run
 * of photos with hours of nothing either side — so `DetectedEvents` reads the
 * last few days and offers the runs it finds. Tap one and the window comes
 * from the actual first and last shutter press, accurate to the minute rather
 * than to the nearest six hours.
 *
 * The picker survives as the fallback, because detection has two honest ways
 * to come up empty: no library permission, and an event that has not been
 * photographed yet — someone creating the event as the party starts. Both end
 * with the same question, now asked second and only when needed.
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
import { DetectedEvents } from './DetectedEvents';
import {
  WHEN_OPTIONS,
  eventDateFor,
  windowFor,
  type Bundle,
  type WindowId,
} from '@parea/autoselect';

export type CreatedEvent = {
  id: string;
  name: string;
  linkToken: string;
  startsAt: string | null;
  endsAt: string | null;
};

/*
 * The picked run is deliberately *not* carried on CreatedEvent.
 *
 * It was, briefly, so the event screen could open the grid on photos already
 * read and narrowed. It did not need to: the run's window is stored on the
 * event, and the event screen's `resolveWindow` already prefers a stored
 * window over anything it could infer. Threading the bundle through bought a
 * skipped rescan and cost a field on a shared type that one screen set and
 * nothing read — which is how the other rotted lists in this repository
 * started.
 */

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
  const [place, setPlace] = useState('');
  const [when, setWhen] = useState<WindowId | null>(null);
  /** Set by tapping a detected run. Supersedes the `when` picker entirely. */
  const [picked, setPicked] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{
    event: CreatedEvent;
    url: string;
    code: string | null;
  } | null>(null);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || (picked === null && when === null)) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();

      // A tapped run wins over the picker. Its window is the real first and
      // last shutter press, padded — not a phrase resolved to a six-hour box.
      const span = picked
        ? {
            startsAt: new Date(picked.window.start).toISOString(),
            endsAt: new Date(picked.window.end).toISOString(),
          }
        : windowFor(when!, now);
      const eventDate = picked ? picked.eventDate : eventDateFor(when!, now);

      const created = await api.createEvent({
        name: trimmed,
        place: place.trim() || undefined,
        groupId,
        eventDate,
        startsAt: span?.startsAt ?? null,
        endsAt: span?.endsAt ?? null,
      });
      setMade({
        event: {
          id: created.id,
          name: created.name,
          linkToken: created.linkToken,
          startsAt: span?.startsAt ?? null,
          endsAt: span?.endsAt ?? null,
        },
        url: `${webBase}/e/${created.linkToken}`,
        code: created.code,
      });
    } catch {
      setError('Could not make the event. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, groupId, name, picked, place, webBase, when]);

  /**
   * Tapping a run fills the name in rather than creating straight away.
   *
   * One tap to create would be one tap to publish a shareable link under a
   * name nobody chose, and "Last night" is a poor name for the event your
   * friends open next week. Prefilling gets it to one tap plus a glance, and
   * the field is already correct if the glance says it is.
   */
  const pick = useCallback(
    (bundle: Bundle) => {
      setPicked(bundle);
      setWhen(null);
      setName((current) => current.trim() || bundle.label);
    },
    [],
  );

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

      {/*
        First, because it is an answer rather than a question, and because the
        thing someone most often wants is the one that just happened. Renders
        nothing at all when there is no permission to ask about or the library
        has already been refused.
      */}
      {!picked && <DetectedEvents t={t} onPick={pick} />}

      {picked && (
        <Pressable
          onPress={() => setPicked(null)}
          style={[styles.card, { backgroundColor: t.card, borderColor: t.accent }]}
        >
          <Text style={[styles.label, { color: t.accent }]}>
            {picked.label} · {picked.count}{' '}
            {picked.count === 1 ? 'photo' : 'photos'}
          </Text>
          <Text style={[styles.small, { color: t.dim }]}>
            {picked.timeRange}. You&rsquo;ll see them and choose before anything
            uploads. Tap to start from something else.
          </Text>
        </Pressable>
      )}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>What was it?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Sarah's birthday"
          placeholderTextColor={t.dim}
          // Deliberately not autoFocus. It was, when this screen opened on a
          // name field; now the detected runs are above it and a keyboard
          // covering them on arrival hides the one thing worth looking at.
          maxLength={120}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Where? (optional)</Text>
        <TextInput
          value={place}
          onChangeText={setPlace}
          placeholder="Hackney"
          placeholderTextColor={t.dim}
          maxLength={80}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Text style={[styles.small, { color: t.dim }]}>
          As you&rsquo;d say it, not an address. It puts this event on your map
          and is only ever shown to people who are already in it.
        </Text>
      </View>

      {/*
        The fallback, and only that. Detection covers the common case — someone
        adding last night — and cannot cover the other one, which is an event
        being created before it has been photographed. That person still has to
        be asked, and a careless answer is still worse than none, so the phrases
        and the reason for asking are unchanged from when this was the only path.
      */}
      {!picked && (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>When was it?</Text>
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
      )}

      {error && <Text style={[styles.body, { color: t.dim }]}>{error}</Text>}

      {/*
        Nothing is pre-selected, so the button waits for an answer rather than
        letting one be skipped past. "Not sure yet" is one of the answers.
      */}
      <Button
        label={busy ? 'Making it…' : picked ? `Make it and add ${picked.count}` : 'Make the event'}
        onPress={create}
        disabled={busy || !name.trim() || (picked === null && when === null)}
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
