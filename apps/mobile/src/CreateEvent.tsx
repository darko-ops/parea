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

import * as Clipboard from 'expo-clipboard';
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
  recentPlaces = [],
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
  /**
   * Places this person has used before, newest first.
   *
   * Their own, from their own events. There is no directory of places and
   * there should not be: suggesting somewhere they have never been would be
   * inventing a fact about them, and a place here is free text a host typed,
   * never anything derived from a photo.
   */
  recentPlaces?: string[];
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
  const [copied, setCopied] = useState(false);
  /** The code is revealed on request; most people just send the link. */
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{
    event: CreatedEvent;
    url: string;
    code: string | null;
  } | null>(null);

  const copy = useCallback(async (url: string) => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    // The label changes back rather than a toast appearing. Feedback belongs
    // on the thing that was pressed.
    setTimeout(() => setCopied(false), 2000);
  }, []);

  /** Both commit controls ask the same question, so it is asked once. */
  const ready = Boolean(name.trim()) && (picked !== null || when !== null);
  const chosenOption = WHEN_OPTIONS.find((option) => option.id === when);
  /** Public unless the creator says otherwise — a forwarded link still works. */
  const [isPrivate, setIsPrivate] = useState(false);

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
        accessPolicy: isPrivate ? 'account_required' : 'link_open',
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
    /*
     * A sheet over the event it just made, rather than a page you are sent to.
     *
     * The event behind it is real and empty, dimmed: that is the thing the
     * link leads to, and seeing it is what makes "an empty event stays empty"
     * land as a fact rather than a slogan. The share step is the most
     * important moment in the product — an event nobody was sent is worth
     * nothing — and it should not feel like a confirmation page.
     */
    return (
      <View style={styles.sheetRoot}>
        <View style={styles.behind}>
          <Text style={[styles.h1, { color: t.fg }]}>{made.event.name}</Text>
          <Text style={[styles.body, { color: t.dim }]}>
            Nothing here yet — add yours first.
          </Text>
        </View>

        <View style={[styles.sheet, { backgroundColor: t.bg }]}>
          <View style={[styles.grab, { backgroundColor: t.line }]} />

          <View style={{ gap: 4 }}>
            <Text style={[styles.sheetTitle, { color: t.fg }]}>
              Send it to everyone who was there
            </Text>
            <Text style={[styles.body, { color: t.dim }]}>
              Anyone with the link sees the photos, with no app to install.
              Adding needs an account.
            </Text>
          </View>

          <View style={[styles.linkRow, { backgroundColor: t.card, borderColor: t.line }]}>
            <Text style={[styles.mono, { color: t.dim }]} numberOfLines={1}>
              {made.url}
            </Text>
            <Pressable onPress={() => copy(made.url)} accessibilityRole="button">
              <Text style={[styles.copy, { color: t.accent }]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          </View>

          {showCode && made.code && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.fieldLabel, { color: t.dim }]}>OR SAY IT OUT LOUD</Text>
              <View style={[styles.codeCard, { backgroundColor: t.card, borderColor: t.line }]}>
                <Text style={[styles.code, { color: t.fg }]}>{made.code}</Text>
              </View>
              <Text style={[styles.small, { color: t.dim }]}>
                For the person across the room whose phone you are not holding.
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                // The system sheet. It already knows which group chat these
                // people use, and picking someone in it tells this app
                // nothing about who they are — which is why there is no
                // contact list here of our own.
                void Share.share({ message: made.url });
              }}
              style={[styles.action, { backgroundColor: t.accent }]}
              accessibilityRole="button"
            >
              <Text style={[styles.actionText, { color: t.onAccent }]}>Send the link</Text>
            </Pressable>
            {made.code && !showCode && (
              <Pressable
                onPress={() => setShowCode(true)}
                style={[styles.action, styles.actionQuiet, { borderColor: t.line }]}
                accessibilityRole="button"
              >
                <Text style={[styles.actionText, { color: t.fg }]}>Say a code</Text>
              </Pressable>
            )}
          </View>

          <Pressable onPress={() => onCreated(made.event)} accessibilityRole="button">
            <Text style={[styles.body, { color: t.accent, textAlign: 'center' }]}>
              Open it and add yours
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {/*
        A modal header rather than a back chevron, and the commit action is in
        it as well as at the foot. Not duplication for its own sake: the
        detected runs make this screen long enough to scroll, and a button
        below the fold is a button someone has to go looking for.
      */}
      <View style={styles.headerRow}>
        <Pressable onPress={onCancel} accessibilityRole="button">
          <Text style={[styles.headerSide, { color: t.accent }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.fg }]}>
          {groupName ? `New in ${groupName}` : 'New event'}
        </Text>
        <Pressable
          onPress={create}
          disabled={ready === false || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: ready === false || busy }}
        >
          <Text
            style={[
              styles.headerSide,
              { color: ready ? t.accent : t.dim, opacity: ready ? 1 : 0.45 },
            ]}
          >
            Share
          </Text>
        </Pressable>
      </View>

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

      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: t.dim }]}>WHAT WAS IT?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Sarah's birthday"
          placeholderTextColor={t.dim}
          // Deliberately not autoFocus. It was, when this screen opened on a
          // name field; now the detected runs are above it and a keyboard
          // covering them on arrival hides the one thing worth looking at.
          maxLength={120}
          style={[
            styles.input,
            styles.inputBig,
            { color: t.fg, borderColor: t.line, backgroundColor: t.card },
          ]}
        />
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={[styles.fieldLabel, { color: t.dim }]}>WHERE</Text>
          <Text style={[styles.small, { color: t.dim }]}>Optional</Text>
        </View>
        <TextInput
          value={place}
          onChangeText={setPlace}
          placeholder="Add a place"
          placeholderTextColor={t.dim}
          maxLength={80}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.card }]}
        />
        {/*
          Places this person has used before, as one tap each. Drawn from
          their own events — there is no directory of places, and suggesting
          somewhere they have never been would be inventing a fact about them.
        */}
        {recentPlaces.length > 0 && (
          <View style={styles.pills}>
            {recentPlaces.map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => setPlace(suggestion)}
                style={[styles.pill, { borderColor: t.line, backgroundColor: t.card }]}
              >
                <Text style={[styles.pillText, { color: t.fg }]}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={[styles.small, { color: t.dim }]}>
          Shows up under Find, by place. Never on the photos.
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
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: t.dim }]}>WHEN</Text>
          <View style={styles.pills}>
            {WHEN_OPTIONS.map((option) => {
              const on = when === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setWhen(option.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.pill,
                    on
                      ? { borderColor: t.accent, borderWidth: 1.5, backgroundColor: t.bg }
                      : { borderColor: t.line, backgroundColor: t.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      on && styles.pillTextOn,
                      { color: on ? t.accent : t.fg },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/*
            The selected option's own description, then why the question is
            being asked at all. The hint alone reads as trivia; the reason is
            what makes someone answer it carefully, and a careless answer here
            pre-selects the wrong photos on somebody else's phone.
          */}
          <Text style={[styles.small, { color: t.dim }]}>
            {chosenOption ? `${capitalise(chosenOption.hint)}. ` : ''}
            It is what lets everyone&rsquo;s own photos from the right hours be
            found for them later, instead of asking them to scroll.
            &ldquo;Not sure yet&rdquo; is a real answer.
          </Text>

          <Text style={[styles.fieldLabel, { color: t.dim, marginTop: 20 }]}>
            WHO CAN SEE IT
          </Text>
          <View style={styles.pills}>
            {(
              [
                [false, 'Anyone with the link'],
                [true, 'Only people signed in'],
              ] as [boolean, string][]
            ).map(([value, label]) => {
              const on = isPrivate === value;
              return (
                <Pressable
                  key={label}
                  onPress={() => setIsPrivate(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.pill,
                    on
                      ? { borderColor: t.accent, borderWidth: 1.5, backgroundColor: t.bg }
                      : { borderColor: t.line, backgroundColor: t.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      on && styles.pillTextOn,
                      { color: on ? t.accent : t.fg },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/*
            Said as what it costs rather than as the name of a policy. Nobody
            picking between two pills at a party is going to reason about
            "account_required".
          */}
          <Text style={[styles.small, { color: t.dim }]}>
            {isPrivate
              ? 'The link still has to reach them, and they sign in before they see anything. For when the link may travel further than the guest list.'
              : 'Whoever holds the link sees the photos, no account needed. Adding photos always needs one.'}
          </Text>
        </View>
      )}

      {error && <Text style={[styles.body, { color: t.dim }]}>{error}</Text>}

      {/*
        Nothing is pre-selected, so the button waits for an answer rather than
        letting one be skipped past. "Not sure yet" is one of the answers.
      */}
      <Button
        label={busy ? 'Making it…' : picked ? `Get a link and add ${picked.count}` : 'Get a link'}
        onPress={create}
        disabled={busy || !ready}
        t={t}
        primary
      />
      {busy && <ActivityIndicator color={t.accent} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 64, paddingBottom: 40, gap: 18 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerSide: { fontSize: 16 },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  field: { gap: 8 },
  fieldHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  /* All-caps and small: a section marker, not the question. The question is
     the input under it, which is large enough to be the thing you read. */
  fieldLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  pillText: { fontSize: 15 },
  pillTextOn: { fontWeight: '600' },
  inputBig: { fontSize: 22, fontWeight: '700', borderRadius: 14, paddingVertical: 14 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  /* The real, empty event behind the sheet — dimmed, but there. Seeing it is
     what makes "an empty event stays empty" a fact rather than a slogan. */
  behind: { flex: 1, opacity: 0.5, padding: 20, paddingTop: 72, gap: 10 },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 26,
    gap: 16,
    shadowColor: '#14171c',
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.14,
    shadowRadius: 40,
    elevation: 24,
  },
  grab: { width: 40, height: 5, borderRadius: 999, alignSelf: 'center' },
  sheetTitle: { fontSize: 22, fontWeight: '700' },
  linkRow: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { fontSize: 15, fontWeight: '600' },
  codeCard: { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  actionQuiet: { backgroundColor: 'transparent', borderWidth: 1 },
  actionText: { fontSize: 16, fontWeight: '600' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  mono: { fontSize: 15, fontFamily: 'Courier' },
  code: { fontSize: 24, fontWeight: '700', letterSpacing: 1 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
});

/** The hints read as sentence fragments; this one starts a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
