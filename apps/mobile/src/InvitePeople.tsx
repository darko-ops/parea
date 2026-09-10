/**
 * Asking people into an album, on the phone.
 *
 * The app could make a private album and then not put anybody in it. Private
 * means added or let in, and only the second half existed here: send the link,
 * wait to be asked, answer. Adding — the half where the person who made it
 * names somebody — was web-only, so an app-only account could create an album
 * nobody could get into except by knocking on it.
 *
 * ## Picking somebody is not adding them
 *
 * The route writes an `open` invitation and nothing else; accepting is what
 * grants access. That is not a detail of the endpoint, it is the rule the
 * screen has to say out loud, because "Add" reads as done: a host who could
 * add people outright would be writing their guest list into somebody else's
 * account. So the copy says asked, everywhere, and the chips are people who
 * are *going to be* asked.
 *
 * ## Two lists, because they are two different questions
 *
 * Friends are who you have already agreed with, and need no typing. Search
 * reaches anybody by handle, debounced, because it fires per keystroke against
 * a walk of the account table — the same delay the web picker uses, for the
 * same reason.
 *
 * Blocks are not filtered here and must not be: `/api/people` already hides
 * each of two people from the other, and the route checks again per person
 * before it writes anything. A client-side list is a suggestion; the decision
 * belongs where the rows are.
 *
 * Faces, since both endpoints send one — and the letter underneath it for
 * somebody who has no picture, or whose URL has aged out. That was the reason
 * for adding a picture to those two replies: a column of identical letters is
 * a list you read, where a face is one you pick somebody out of, and this
 * screen is the one asking "who is this album for".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api, InvitablePerson } from './api';
import type { GroupTheme } from './Groups';

/** What the server takes in one request. Said here so the copy can say it. */
const MAX_PER_REQUEST = 50;

/** Long enough that a handle being typed does not spend a request per letter. */
const SEARCH_DELAY_MS = 250;

export function nameOf(person: InvitablePerson): string {
  return person.displayName?.trim() || (person.handle ? `@${person.handle}` : 'Someone');
}

function initialOf(name: string): string {
  return name.replace(/^@/, '').slice(0, 1).toUpperCase() || '?';
}

function Chip({
  person,
  t,
  chosen,
  onPress,
}: {
  person: InvitablePerson;
  t: GroupTheme;
  chosen: boolean;
  onPress: () => void;
}) {
  const name = nameOf(person);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={chosen ? `${name}, take out` : `Ask ${name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: chosen ? t.accent : t.line },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {/*
        Their picture, and the letter when there is none.

        No failure handler on the `Image`: an avatar that will not load draws
        nothing here and the circle stays, which is the honest degradation on a
        chip 26pt across — the web's `Face` swaps in the letter because its
        rows are big enough for the swap to be worth the state.
      */}
      {person.avatar ? (
        <Image
          source={{ uri: person.avatar }}
          style={[styles.letter, { backgroundColor: t.line }]}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.letter, { backgroundColor: t.line }]}>
          <Text style={[styles.letterText, { color: t.dim }]}>{initialOf(name)}</Text>
        </View>
      )}
      <Text style={[styles.chipText, { color: chosen ? t.accent : t.fg }]}>{name}</Text>
      {chosen && <Text style={[styles.chipX, { color: t.accent }]}>×</Text>}
    </Pressable>
  );
}

/**
 * The picker, holding nothing it has not been given.
 *
 * `picked` lives with the caller because the two callers do opposite things
 * with it: the create screen keeps the choice until there is an album to
 * attach it to — backing out of that form asks nobody, where a picker that
 * sent as it went would leave a trail of invitations to an album that was
 * never made — and the event screen sends immediately, because the album is
 * already there.
 */
export function InvitePicker({
  api,
  t,
  picked,
  onChange,
}: {
  api: Api;
  t: GroupTheme;
  picked: InvitablePerson[];
  onChange: (next: InvitablePerson[]) => void;
}) {
  const [friends, setFriends] = useState<InvitablePerson[]>([]);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<InvitablePerson[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .friends()
      .then((list) => {
        if (live) setFriends(list);
      })
      // A picker with no friends in it still works: the search box is the
      // other half, and an error here must not close the door on both.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    const q = term.trim();
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) {
      setFound([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => {
      void api
        .findPeople(q)
        .then(setFound)
        .catch(() => setFound([]))
        .finally(() => setSearching(false));
    }, SEARCH_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [api, term]);

  const toggle = useCallback(
    (person: InvitablePerson) => {
      const already = picked.some((p) => p.actorId === person.actorId);
      if (already) {
        onChange(picked.filter((p) => p.actorId !== person.actorId));
        return;
      }
      // Refused rather than truncated on send: somebody who has chosen
      // fifty-one people should be told by the control, not by a 400.
      if (picked.length >= MAX_PER_REQUEST) return;
      onChange([...picked, person]);
    },
    [onChange, picked],
  );

  const isPicked = (person: InvitablePerson) =>
    picked.some((p) => p.actorId === person.actorId);
  const offered = (list: InvitablePerson[]) => list.filter((p) => !isPicked(p));

  return (
    <View>
      {picked.length > 0 && (
        <View style={styles.chips}>
          {picked.map((person) => (
            <Chip
              key={person.actorId}
              person={person}
              t={t}
              chosen
              onPress={() => toggle(person)}
            />
          ))}
        </View>
      )}

      <TextInput
        value={term}
        onChangeText={setTerm}
        placeholder="Find somebody by handle"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { borderColor: t.line, color: t.fg }]}
        accessibilityLabel="Find somebody by handle"
      />

      {searching && <ActivityIndicator color={t.accent} style={styles.spinner} />}

      {term.trim().length >= 2 && !searching && found.length === 0 && (
        // Not "no such person": the search hides anybody either side of a
        // block, so a handle that exists can legitimately answer nothing, and
        // saying they do not exist would be this screen guessing why.
        <Text style={[styles.hint, { color: t.dim }]}>Nobody to show for that.</Text>
      )}

      {offered(found).length > 0 && (
        <View style={styles.chips}>
          {offered(found).map((person) => (
            <Chip
              key={person.actorId}
              person={person}
              t={t}
              chosen={false}
              onPress={() => toggle(person)}
            />
          ))}
        </View>
      )}

      {offered(friends).length > 0 && (
        <>
          <Text style={[styles.lead, { color: t.dim }]}>FRIENDS</Text>
          <View style={styles.chips}>
            {offered(friends).map((person) => (
              <Chip
                key={person.actorId}
                person={person}
                t={t}
                chosen={false}
                onPress={() => toggle(person)}
              />
            ))}
          </View>
        </>
      )}

      <Text style={[styles.hint, { color: t.dim }]}>
        {picked.length >= MAX_PER_REQUEST
          ? `That is ${MAX_PER_REQUEST}, which is as many as one go takes.`
          : 'Nobody is put into an album by somebody else. They are asked, and they answer under Events.'}
      </Text>
    </View>
  );
}

/**
 * The same picker with a button under it, for an album that already exists.
 *
 * Its own state, because there is nothing to hold the choice for: the album is
 * there, so asking is one press away and the chips empty when it lands. The
 * count comes back from the server rather than from the length of what was
 * sent — the route drops anybody it will not write, and reporting the ask as
 * bigger than it was would be the screen inventing an answer.
 */
export function InviteCard({
  api,
  t,
  eventId,
  Button,
}: {
  api: Api;
  t: GroupTheme;
  eventId: string;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [picked, setPicked] = useState<InvitablePerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const send = useCallback(async () => {
    if (picked.length === 0) return;
    setBusy(true);
    setSaid(null);
    try {
      const { invited } = await api.invite(
        eventId,
        picked.map((person) => person.actorId),
      );
      setPicked([]);
      setSaid(
        invited === 0
          ? 'Nobody new to ask — they had already been asked.'
          : `Asked ${invited}. It is under their Events now.`,
      );
    } catch {
      setSaid('Could not ask just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, eventId, picked]);

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>Add people</Text>
      <InvitePicker api={api} t={t} picked={picked} onChange={setPicked} />
      <Button
        label={busy ? 'Asking…' : picked.length > 0 ? `Ask ${picked.length}` : 'Ask'}
        onPress={() => void send()}
        t={t}
        primary
        disabled={busy || picked.length === 0}
      />
      {said && <Text style={[styles.hint, { color: t.dim }]}>{said}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  label: { fontSize: 16, fontWeight: '600' },
  lead: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 15,
    fontSize: 16,
    marginTop: 12,
  },
  spinner: { marginTop: 12 },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  /* The same chip the group form uses: a letter, a name, and an × once it is
     chosen — one shape for "a person you are picking", wherever it is asked. */
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13.5, fontWeight: '600' },
  chipX: { fontSize: 14, opacity: 0.7 },
  letter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: { fontSize: 12, fontWeight: '700' },
});
