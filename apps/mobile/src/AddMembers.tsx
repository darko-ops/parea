/**
 * Adding people to a roll, from the top of its People pane.
 *
 * A page rather than a sheet: it is somewhere you look through people, and
 * Back lands on the list you came from with whoever you just asked on it.
 *
 * ## Suggested first
 *
 * Before anything is typed the page is already the answer for most rolls:
 * your friends who are not in it yet, then the friends of your friends — the
 * same suggestions Find draws, most mutuals first. Typing searches everybody
 * by name or handle, debounced as the picker elsewhere is.
 *
 * ## Adding is asking
 *
 * The route writes an invitation and accepting is what lets somebody in —
 * see `InvitePeople.tsx` for why. So the button says Add, because that is
 * what the person pressing it means, and the row then says Asked, because
 * that is what happened. The line under the field says the rest.
 */

import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api, InvitablePerson, Roster } from './api';
import type { GroupTheme } from './Groups';
import { nameOf } from './InvitePeople';
import { initialOf, lensFor } from './lens';
import { askNotInGroup, notInGroupOf } from './notInGroup';
import { Back, RoundButton } from './RoundButton';

/** Long enough that a handle being typed does not spend a request per letter. */
const SEARCH_DELAY_MS = 250;

type Where = 'in' | 'asked' | 'asking' | 'failed' | null;

export function AddMembers({
  api,
  t,
  eventId,
  roster,
  onBack,
  onAsked,
}: {
  api: Api;
  t: GroupTheme;
  eventId: string;
  /** Who is in the roll or already asked, so neither is offered again. */
  roster: Roster[];
  onBack: () => void;
  /** Somebody was asked — the roster re-reads, and they appear on it. */
  onAsked: () => void;
}) {
  const [suggested, setSuggested] = useState<InvitablePerson[] | null>(null);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<InvitablePerson[]>([]);
  const [searching, setSearching] = useState(false);
  /** Asked from this page, by actor — the roster catches up on its own poll. */
  const [mine, setMine] = useState<Record<string, Where>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Already in it, or already asked, according to the roll. */
  const known = useMemo(() => {
    const map = new Map<string, Where>();
    for (const person of roster) {
      if (person.actorId) map.set(person.actorId, person.role === 'invited' ? 'asked' : 'in');
    }
    return map;
  }, [roster]);

  /*
   * Friends not in the roll, then friends of friends — each list failing on
   * its own, since either alone is still a page worth having.
   */
  useEffect(() => {
    let live = true;
    void Promise.all([
      api.friends().catch(() => [] as InvitablePerson[]),
      api.suggestedPeople().catch(() => [] as InvitablePerson[]),
    ]).then(([friends, more]) => {
      if (!live) return;
      const seen = new Set<string>();
      const list: InvitablePerson[] = [];
      for (const person of [...friends, ...more]) {
        if (seen.has(person.actorId) || known.get(person.actorId) === 'in') continue;
        seen.add(person.actorId);
        list.push(person);
      }
      setSuggested(list);
    });
    return () => {
      live = false;
    };
    // `known` is read once, for the first draw: somebody who arrives while the
    // page is open stays where they were rather than vanishing under a thumb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const add = useCallback(
    async (person: InvitablePerson) => {
      const id = person.actorId;
      setMine((was) => ({ ...was, [id]: 'asking' }));
      try {
        await api.invite(eventId, [id]);
        setMine((was) => ({ ...was, [id]: 'asked' }));
        onAsked();
      } catch (err) {
        // Somebody outside the roll's group: asked into the group instead, or
        // the roll taken out of it — the question every other picker puts.
        const outside = notInGroupOf(err);
        if (!outside) {
          setMine((was) => ({ ...was, [id]: 'failed' }));
          return;
        }
        setMine((was) => ({ ...was, [id]: null }));
        askNotInGroup(outside, {
          onAddToGroup: () =>
            void api
              .invite(eventId, [id], [], true)
              .then(() => {
                setMine((was) => ({ ...was, [id]: 'asked' }));
                onAsked();
              })
              .catch(() => setMine((was) => ({ ...was, [id]: 'failed' }))),
          onTakeOut: () =>
            void api
              .takeOutOfGroup(eventId)
              .then(() => api.invite(eventId, [id]))
              .then(() => {
                setMine((was) => ({ ...was, [id]: 'asked' }));
                onAsked();
              })
              .catch(() => setMine((was) => ({ ...was, [id]: 'failed' }))),
        });
      }
    },
    [api, eventId, onAsked],
  );

  const where = (person: InvitablePerson): Where =>
    mine[person.actorId] ?? known.get(person.actorId) ?? null;

  const row = (person: InvitablePerson) => {
    const name = nameOf(person);
    const lens = lensFor(person.handle ?? person.actorId);
    const state = where(person);
    const offer = state === null || state === 'failed';
    return (
      <View key={person.actorId} style={[styles.row, { borderBottomColor: t.line }]}>
        {person.avatar ? (
          <Image
            source={{ uri: person.avatar }}
            style={[styles.face, { backgroundColor: t.line }]}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View style={[styles.face, styles.blank, { backgroundColor: lens.fill }]}>
            <Text style={[styles.letter, { color: lens.ink }]}>{initialOf(name)}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
            {name}
          </Text>
          {person.displayName && person.handle && (
            <Text style={[styles.handle, { color: t.dim }]} numberOfLines={1}>
              @{person.handle}
            </Text>
          )}
        </View>
        {offer ? (
          <Pressable
            onPress={() => void add(person)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${name}`}
            hitSlop={6}
            style={({ pressed }) => [
              styles.add,
              { backgroundColor: t.fg, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.addText, { color: t.bg }]}>
              {state === 'failed' ? 'Try again' : 'Add'}
            </Text>
          </Pressable>
        ) : state === 'asking' ? (
          <ActivityIndicator color={t.dim} style={styles.spinnerSmall} />
        ) : (
          <Text style={[styles.done, { color: t.dim }]}>
            {state === 'in' ? 'In the roll' : 'Asked'}
          </Text>
        )}
      </View>
    );
  };

  const typing = term.trim().length >= 2;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* The same disc, in the same corner, as every other way back. */}
      <RoundButton t={t} onPress={onBack} accessibilityLabel="Back" style={styles.back}>
        <Back color={t.fg} />
      </RoundButton>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { color: t.fg }]}>Add members</Text>

        <TextInput
          value={term}
          onChangeText={setTerm}
          placeholder="Search by name or handle"
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[styles.input, { borderColor: t.line, color: t.fg }]}
          accessibilityLabel="Search by name or handle"
        />
        <Text style={[styles.hint, { color: t.dim }]}>
          Nobody is put into a roll by somebody else. They are asked, and they
          answer in Lately.
        </Text>

        {typing ? (
          <View>
            {searching && <ActivityIndicator color={t.dim} style={styles.spinner} />}
            {!searching && found.length === 0 && (
              // Not "no such person": the search hides anybody either side of
              // a block, so a handle that exists can answer nothing.
              <Text style={[styles.hint, { color: t.dim }]}>Nobody to show for that.</Text>
            )}
            {!searching && found.map(row)}
          </View>
        ) : (
          <View>
            <Text style={[styles.lead, { color: t.dim }]}>SUGGESTED</Text>
            {suggested === null && <ActivityIndicator color={t.dim} style={styles.spinner} />}
            {suggested?.length === 0 && (
              <Text style={[styles.hint, { color: t.dim }]}>
                Nobody to suggest yet. Search for somebody above.
              </Text>
            )}
            {suggested?.map(row)}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* Find Friends' corner and inset, so Back is where it always is. */
  back: { position: 'absolute', top: 52, left: 16, zIndex: 3 },
  scroll: { paddingTop: 100, paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  hint: { fontSize: 12.5, lineHeight: 18 },
  lead: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginTop: 8, marginBottom: 2 },
  spinner: { marginVertical: 16 },
  spinnerSmall: { width: 64 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // A rounded square, like every other face in this product (`Groups.tsx`).
  face: { width: 38, height: 38, borderRadius: 10, overflow: 'hidden' },
  blank: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 15, fontWeight: '700' },
  name: { fontSize: 15.5, fontWeight: '600' },
  handle: { fontSize: 13 },
  add: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  addText: { fontSize: 13.5, fontWeight: '600' },
  done: { fontSize: 13.5, fontWeight: '500' },
});
