/**
 * The door of a private album, on the phone.
 *
 * Private means added, or let in. Somebody who has the link and neither of
 * those is not lost and has not made a mistake — they are standing at a door,
 * and the app used to tell them the album did not exist: `/api/join` refused
 * every denial as 404, so a correct link came back as "Couldn't find that.
 * Check the link or the code and try again." They check it. It is right.
 *
 * What is on the screen is bounded by what they have proved. The name, because
 * the link they were sent is where it came from and it is not news to them —
 * and nothing else. No photographs, no count, no members, no cover: those are
 * what they are asking for, and this screen exists at the moment before the
 * answer.
 *
 * ## Nothing here is optimistic
 *
 * The state on the screen is the state the server reported. Asking twice is
 * one row either way — `/api/events/:id/access-requests` answers a repeat with
 * the status it already holds — so a request that was declined comes back
 * `declined` rather than reopening, and this screen says "Asked" over it
 * rather than "Declined". Telling somebody they were refused is the refuser's
 * to do; a screen that did it for them would do it again on every visit.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Api } from './api';
import type { GroupTheme } from './Groups';
import { Waiting } from './Waiting';

/** What the last answer left standing, as far as this screen is concerned. */
type Asked = 'none' | 'sent' | 'in';

export function DoorScreen({
  api,
  eventId,
  name,
  t,
  onBack,
  /** Called when the ask came back already approved — there is a room to open. */
  onLetIn,
  Button,
}: {
  api: Api;
  eventId: string;
  /** The album's name, off the refusal. Never fetched from here. */
  name: string;
  t: GroupTheme;
  onBack: () => void;
  onLetIn: () => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [asked, setAsked] = useState<Asked>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { status } = await api.askToJoin(eventId);
      /*
       * `approved` is a real answer to a first ask: somebody let this person in
       * between the link being sent and the button being pressed, or they were
       * approved on another device. The album is open, so the screen hands
       * over rather than reporting that a request is pending against a door
       * that is no longer shut.
       */
      if (status === 'approved') {
        setAsked('in');
        onLetIn();
        return;
      }
      setAsked('sent');
    } catch {
      setError('Could not ask just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, eventId, onLetIn]);

  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={[styles.back, { color: t.accent }]}>‹ Back</Text>
      </Pressable>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.kind, { color: t.dim }]}>PRIVATE ALBUM</Text>
        <Text style={[styles.name, { color: t.fg }]}>{name}</Text>

        {asked === 'none' ? (
          <>
            <Text style={[styles.body, { color: t.dim }]}>
              Your link is good, and a link is not the way in to this one.
              Whoever made it decides — ask, and they will see it with your
              name on it.
            </Text>
            {busy ? (
              <Waiting size={28} />
            ) : (
              <Button label="Ask to join" onPress={() => void ask()} t={t} primary />
            )}
          </>
        ) : (
          <Text style={[styles.body, { color: t.dim }]}>
            {/*
              One sentence for sent and for a repeat, deliberately. See the
              header: a decline is not this screen's to announce.
            */}
            Asked. It is with whoever made the album now — the photos turn up
            under Events if they let you in.
          </Text>
        )}

        {error && <Text style={[styles.body, { color: t.dim }]}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, paddingTop: 72, gap: 14 },
  back: { fontSize: 15, lineHeight: 21 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  /* Small, spaced and above the name: it says what kind of thing this is
     before the name says which one, which is the order somebody reads a door
     they did not expect. */
  kind: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  name: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
});
