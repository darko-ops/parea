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
 *
 * ## Two questions, one picker
 *
 * An album set to `host` asks a second one on the same screen — which of these
 * people holds the camera — and it is the same act of finding a person. So
 * `placeholder` and `exclude` are arguments and the lists are not. See them
 * below.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api, InvitablePerson } from './api';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { askNotInGroup, notInGroupOf } from './notInGroup';
import { lensFor } from './lens';

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
  /**
   * What the search box says it is for.
   *
   * An argument because the same picker asks two questions on one screen — who
   * is in the album, and which of them holds the camera — and they are the same
   * act of finding a person: the same two lists, the same debounce, the same
   * rule that picking somebody asks them rather than adds them. Only the words
   * differ, so only the words are passed in.
   */
  placeholder = 'Find somebody by name or handle',
  /**
   * Actors this picker must not offer.
   *
   * What keeps the two questions from disagreeing. Somebody already named a
   * co-host must not also be offered under "who is in it": they are being asked
   * into the album either way, and a name in both places is one invitation that
   * looks like two decisions.
   */
  exclude,
}: {
  api: Api;
  t: GroupTheme;
  picked: InvitablePerson[];
  onChange: (next: InvitablePerson[]) => void;
  placeholder?: string;
  exclude?: Set<string>;
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
  const offered = (list: InvitablePerson[]) =>
    list.filter((p) => !isPicked(p) && !exclude?.has(p.actorId));

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
        placeholder={placeholder}
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { borderColor: t.line, color: t.fg }]}
        accessibilityLabel={placeholder}
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
          : 'Nobody is put into a roll by somebody else. They are asked, and they answer in Lately.'}
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
  onUngrouped,
}: {
  api: Api;
  t: GroupTheme;
  eventId: string;
  /** The roll was taken out of its group to let somebody in — the sheet re-reads. */
  onUngrouped?: () => void;
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
    const ids = picked.map((person) => person.actorId);
    const asked = (invited: number) =>
      invited === 0
        ? 'Nobody new to ask — they had already been asked.'
        : `Asked ${invited}. It is under their Events now.`;
    try {
      const { invited } = await api.invite(eventId, ids);
      setPicked([]);
      setSaid(asked(invited));
    } catch (err) {
      /*
       * Somebody outside the roll's group: not asked into the roll, and the
       * question put instead — into the group, or the roll out of it.
       */
      const outside = notInGroupOf(err);
      if (!outside) {
        setSaid('Could not ask just now. Try again in a moment.');
        return;
      }
      askNotInGroup(outside, {
        onAddToGroup: async () => {
          try {
            const answer = await api.invite(eventId, ids, [], true);
            setPicked([]);
            setSaid(
              `Asked ${answer.toGroup ?? 0} to join ${outside.group.name}. They’ll see this roll once they’re in.`,
            );
          } catch {
            setSaid('Could not ask just now. Try again in a moment.');
          }
        },
        onTakeOut: async () => {
          try {
            await api.takeOutOfGroup(eventId);
            const { invited } = await api.invite(eventId, ids);
            setPicked([]);
            setSaid(`Removed from ${outside.group.name}. ${asked(invited)}`);
            onUngrouped?.();
          } catch {
            setSaid('Could not do that just now. Try again in a moment.');
          }
        },
      });
    } finally {
      setBusy(false);
    }
  }, [api, eventId, picked, onUngrouped]);

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

/** The first word of somebody's name, for a line that lists several. */
function firstNameOf(person: InvitablePerson): string {
  return nameOf(person).split(/\s+/)[0] ?? nameOf(person);
}

/**
 * What the card says, per question it is asking.
 *
 * The same card asks two things on the create screen — who is in the roll, and,
 * on a roll set to "Hosts", who holds the camera — and they are the same act of
 * finding a person. Only the words differ, so only the words are a table.
 */
const WORDS = {
  invite: { title: 'Invite friends', count: (n: number) => `${n} invited`, empty: 'tap to pick friends', asked: 'will be asked' },
  hosts: { title: 'Add hosts', count: (n: number) => (n === 1 ? '1 host' : `${n} hosts`), empty: 'tap to pick who can add', asked: 'will be asked to host' },
} as const;

export type InviteKind = keyof typeof WORDS;

/** "Nobody yet", "Maya & Priya", "Maya, Jonah +2" — then what happens to them. */
function askedLine(picked: {}[], names: string[], kind: InviteKind): string {
  const words = WORDS[kind];
  if (picked.length === 0) return `Nobody yet — ${words.empty}`;
  if (names.length <= 2) return `${names.join(' & ')} ${words.asked}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} ${words.asked}`;
}

/**
 * A face: their picture, or their letter on their lens colour.
 *
 * The lens is keyed on the actor rather than the name so somebody is the same
 * colour here as over an album's cover, whatever they have called themselves.
 */
function Face({
  person,
  size,
  letterSize,
  style,
}: {
  person: InvitablePerson;
  size: number;
  letterSize: number;
  style?: object;
}) {
  const lens = lensFor(person.actorId);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (person.avatar) {
    return (
      <Image
        source={{ uri: person.avatar }}
        style={[round, { backgroundColor: lens.fill }, style]}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[round, styles.faceLetterBox, { backgroundColor: lens.fill }, style]}>
      <Text style={{ fontSize: letterSize, fontWeight: '700', color: lens.ink }}>
        {initialOf(nameOf(person))}
      </Text>
    </View>
  );
}

/** One face on the rail: shrunk and dim until picked, then ringed and checked. */
function RailFace({
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
  const on = useRef(new Animated.Value(chosen ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(on, { toValue: chosen ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [chosen, on]);
  const name = nameOf(person);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={chosen ? `${name}, take out` : `Ask ${name}`}
      onPress={onPress}
      style={styles.railItem}
    >
      <Animated.View
        style={{ transform: [{ scale: on.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}
      >
        <Face person={person} size={54} letterSize={19} />
        {/* The double ring: 2.5 of the card showing through, then the accent. */}
        <View
          pointerEvents="none"
          style={[styles.railRing, { borderColor: chosen ? t.accent : 'transparent' }]}
        />
        <Animated.View
          style={[
            styles.check,
            { backgroundColor: t.accent, borderColor: t.card, opacity: on },
          ]}
        >
          <Text style={[styles.checkMark, { color: t.onAccent }]}>✓</Text>
        </Animated.View>
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[styles.railName, { color: chosen ? t.fg : t.dim }]}
      >
        {firstNameOf(person)}
      </Text>
    </Pressable>
  );
}

/**
 * Asking people in from the create screen: a card that says who, and opens
 * onto a rail of faces.
 *
 * Closed, it is one line — the faces already picked, stacked, and how many.
 * Open, it is the same two sources `InvitePicker` reads, friends and a search
 * by handle, drawn as faces to tap rather than chips to read. Picking still
 * asks rather than adds, and nothing is sent until the roll exists: `picked`
 * lives with the caller for the reason it does there.
 */
export function InviteFaces({
  api,
  t,
  picked,
  onChange,
  /** The search field took focus — the caller moves it above the keyboard. */
  onSearchFocus,
  /** Which question this card is asking — see `WORDS`. */
  kind = 'invite',
  /**
   * Actors this card must not offer: whoever the other card on the screen has
   * picked. Both lists are one guest list, and a name in both is one
   * invitation dressed as two decisions.
   */
  exclude,
}: {
  api: Api;
  t: GroupTheme;
  picked: InvitablePerson[];
  onChange: (next: InvitablePerson[]) => void;
  onSearchFocus?: () => void;
  kind?: InviteKind;
  exclude?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<InvitablePerson[]>([]);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<InvitablePerson[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let live = true;
    void api
      .friends()
      .then((list) => {
        if (live) setFriends(list);
      })
      // The search is the other half; an error here must not close both.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);

  // The same debounce and the same two-letter floor as `InvitePicker`.
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

  // The panel's height by layout animation; the button's fill by its own,
  // since a colour is not something a layout animation moves.
  const toggleOpen = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.create(300, 'easeInEaseOut', 'opacity'));
    setOpen((was) => !was);
  }, []);

  useEffect(() => {
    Animated.timing(lit, { toValue: open ? 1 : 0, duration: 250, useNativeDriver: false }).start();
  }, [lit, open]);

  const isPicked = (person: InvitablePerson) =>
    picked.some((p) => p.actorId === person.actorId);

  const toggle = (person: InvitablePerson) => {
    if (isPicked(person)) {
      onChange(picked.filter((p) => p.actorId !== person.actorId));
      return;
    }
    // Refused rather than truncated on send — see `InvitePicker`.
    if (picked.length >= MAX_PER_REQUEST) return;
    onChange([...picked, person]);
  };

  /*
   * What the rail shows.
   *
   * With a search, its results — less anybody already picked, who is in the
   * stack above. Without one, anybody picked from an earlier search first, so
   * they can be tapped back out, then friends.
   */
  const searched = term.trim().length >= 2;
  const friendIds = new Set(friends.map((f) => f.actorId));
  const offered = (p: InvitablePerson) => !exclude?.has(p.actorId);
  const rail = (
    searched
      ? found.filter((p) => !isPicked(p))
      : [...picked.filter((p) => !friendIds.has(p.actorId)), ...friends]
  ).filter(offered);

  // Nobody picked: the first three friends, faint, as a hint of what goes here.
  const stack = picked.length > 0 ? picked.slice(0, 3) : friends.filter(offered).slice(0, 3);
  const hint = picked.length === 0;
  const words = WORDS[kind];
  const title = picked.length === 0 ? words.title : words.count(picked.length);

  return (
    <View
      style={[
        styles.inviteCard,
        { backgroundColor: t.card, borderColor: open ? t.lineStrong : t.line },
      ]}
    >
      <Pressable
        onPress={toggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.inviteHead}
      >
        {stack.length > 0 && (
          <View style={[styles.stack, hint && { opacity: 0.35 }]}>
            {stack.map((person, index) => (
              <Face
                key={person.actorId}
                person={person}
                size={34}
                letterSize={13}
                style={[
                  styles.stackFace,
                  { borderColor: t.card },
                  index > 0 && { marginLeft: -10 },
                ]}
              />
            ))}
          </View>
        )}
        <View style={styles.inviteText}>
          <Text style={[styles.inviteTitle, { color: t.fg }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.inviteSub, { color: t.dim }]}>
            {askedLine(picked, picked.map(firstNameOf), kind)}
          </Text>
        </View>
        <Animated.View
          style={[
            styles.searchButton,
            {
              backgroundColor: lit.interpolate({
                inputRange: [0, 1],
                outputRange: [t.bg, t.accent],
              }),
            },
          ]}
        >
          <Glyph name="search" size={18} color={open ? t.onAccent : t.fg} />
        </Animated.View>
      </Pressable>

      {open && (
        <View>
          <View style={[styles.searchField, { backgroundColor: t.bg }]}>
            <Glyph name="search" size={17} color={t.dim} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              onFocus={onSearchFocus}
              placeholder="Search by name or @handle"
              placeholderTextColor={t.dim}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { color: t.fg }]}
              accessibilityLabel="Search by name or @handle"
            />
            {searching && <ActivityIndicator color={t.dim} />}
          </View>

          {rail.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.rail}
            >
              {rail.map((person) => (
                <RailFace
                  key={person.actorId}
                  person={person}
                  t={t}
                  chosen={isPicked(person)}
                  onPress={() => toggle(person)}
                />
              ))}
            </ScrollView>
          ) : (
            // Not "no such person": the search hides anybody either side of a
            // block, so a handle that exists can legitimately answer nothing.
            <Text style={[styles.railEmpty, { color: t.dim }]}>
              {searched
                ? searching
                  ? ' '
                  : 'Nobody to show for that.'
                : 'Search for somebody by name or @handle.'}
            </Text>
          )}

          {picked.length >= MAX_PER_REQUEST && (
            <Text style={[styles.railEmpty, { color: t.dim, paddingTop: 0 }]}>
              {`That is ${MAX_PER_REQUEST}, which is as many as one go takes.`}
            </Text>
          )}
        </View>
      )}
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
  inviteCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  inviteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 14,
  },
  stack: { flexDirection: 'row' },
  /* The card's colour as a ring, so overlapping faces read as separate. */
  stackFace: { borderWidth: 2.5 },
  faceLetterBox: { alignItems: 'center', justifyContent: 'center' },
  inviteText: { flex: 1, gap: 2 },
  inviteTitle: { fontSize: 15, fontWeight: '600' },
  inviteSub: { fontSize: 13 },
  searchButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 11 },
  rail: { paddingVertical: 16, paddingHorizontal: 14, gap: 14 },
  railItem: { width: 58, alignItems: 'center', gap: 6 },
  /* Outside the face, so picking somebody does not shrink their picture. */
  railRing: {
    position: 'absolute',
    top: -4.5,
    left: -4.5,
    right: -4.5,
    bottom: -4.5,
    borderWidth: 2,
    borderRadius: 999,
  },
  railName: { fontSize: 12, fontWeight: '600' },
  railEmpty: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 16 },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 12, fontWeight: '800', lineHeight: 14 },
});
