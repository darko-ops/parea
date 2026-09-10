/**
 * The three tabs' contents: home, search, profile.
 *
 * One word for one thing: an event. These tabs briefly said "event" while the
 * schema said `event`, which meant every file that touched them opened with a
 * paragraph explaining that the two were the same. That paragraph was the cost
 * of the second word, and it bought nothing.
 *
 * All three read from `GET /api/events`, which lists what this actor can
 * actually reach: events they have presented a credential to, plus every event
 * in a group they belong to. Not "everything a link would still open" — a link
 * is something you were sent, not somewhere you live, and an event opened once
 * a year ago does not belong on a home screen.
 */

import { metaFor, mosaicLayout } from '@parea/cards';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api, EventListing, InvitablePerson, MyGroupDetail } from './api';
import type { GroupTheme } from './Groups';
import { loadQueue, signOutDevice } from './platform';
import { RequestBubble } from './Requests';

export type TabTheme = GroupTheme;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The scrim over the blurred bleed.
 *
 * A stack of bands rather than a gradient, because a gradient means
 * `expo-linear-gradient` and that is a native dependency added, unrendered and
 * untested, for one wash of white. The design's scrim runs from 62% to 88%
 * alpha over roughly sixty points — a narrow enough range that four steps are
 * indistinguishable from the real thing, and this needs no prebuild.
 */
function Scrim({ tint }: { tint: string }) {
  const bands = [0.62, 0.71, 0.8, 0.88];
  return (
    <View style={styles.fill} pointerEvents="none">
      {bands.map((alpha) => (
        <View key={alpha} style={{ flex: 1, backgroundColor: withAlpha(tint, alpha) }} />
      ))}
    </View>
  );
}

/** `#rrggbb` plus an alpha, as the `#rrggbbaa` React Native accepts. */
function withAlpha(hex: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex}${byte.toString(16).padStart(2, '0')}`;
}

/**
 * The tile arrangement for a card's mosaic, as `flex` values.
 *
 * The shape itself comes from `@parea/cards`, shared with the web card. It
 * used to be a hand-maintained copy here with a comment saying the web one had
 * to agree with it — which is not a mechanism, it is a hope. All that is left
 * on this side is turning column weights into the layout primitive React
 * Native has, and indices into the URLs this client happens to hold.
 */
function layout(photos: string[]): { flex: number; column: string[] }[] {
  return mosaicLayout(photos.length).map((col) => ({
    flex: col.weight,
    column: col.photos.map((i) => photos[i]!),
  }));
}

/**
 * One event, led by its photos.
 *
 * A name is a poor way to recognise a night out and the photos are a good one,
 * so most of the card is mosaic. Under it the detail strip has no dividing
 * line — the event's own colours bleed upward beneath the text: the same
 * images again, mirrored and blurred, under a scrim.
 *
 * `blurRadius` on `expo-image` rather than a `BlurView` behind it. Blurring
 * the images themselves is what the web card does, it needs no extra native
 * module, and a BlurView here would be sampling a white card rather than the
 * photos — the wrong thing blurred.
 *
 * The counts still carry the card. "6 people, 88 photos" is the recruiting
 * device the concept names (§2), and it reads the same whether you are
 * deciding to open an event or to add to it. It is just no longer the only
 * thing on the card.
 */
function EventCard({
  event,
  meta,
  t,
  onPress,
}: {
  event: EventListing;
  /** Precomputed so every card on screen agrees about what "now" was. */
  meta: string;
  t: TabTheme;
  onPress: () => void;
}) {
  const columns = layout(event.mosaic);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${event.name}, ${plural(event.memberCount, 'member')}, ${plural(event.photoCount, 'photo')}`}
      style={[styles.event, { backgroundColor: t.card, borderColor: t.line }]}
    >
      {columns.length > 0 && (
        <View style={styles.mosaic}>
          {columns.map(({ flex, column }, i) => (
            <View key={i} style={{ flex, gap: 2 }}>
              {column.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={styles.tile}
                  contentFit="cover"
                  transition={120}
                />
              ))}
            </View>
          ))}
        </View>
      )}

      <View style={styles.eventBody}>
        {columns.length > 0 && (
          <>
            {/*
              Decorative. Inset past the edges so the blur has bleed and no
              soft edge shows, and flipped so the colours meeting the text are
              the ones from the bottom of the photos directly above.
            */}
            <View style={styles.bleed} pointerEvents="none">
              {/*
                One band per *column*, at the column's own width — not one per
                photo at equal widths. The point of the effect is that the
                colour under a piece of text is the colour of the photo
                directly above it, and equal bands slide the hero's colour off
                to the left of where it belongs.
              */}
              {columns.map(({ flex, column }, i) => (
                <Image
                  key={i}
                  source={{ uri: column[0]! }}
                  style={{ flex, height: '100%' }}
                  contentFit="cover"
                  blurRadius={18}
                />
              ))}
            </View>
            <Scrim tint={t.card} />
          </>
        )}

        <View style={[styles.eventText, columns.length === 0 && styles.eventTextBare]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.eventName, { color: t.fg }]} numberOfLines={1}>
              {event.name}
            </Text>
            <Text style={[styles.body, { color: t.dim }]} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {/*
            A bare number. "88 photos" in a pill with an icon is three pieces
            of furniture around one fact, and a column of numbers down the
            right of the list is easier to read than any of them.
          */}
          <Text style={[styles.eventCount, { color: t.dim }]}>{event.photoCount}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * A clock that ticks once a minute, for the "20m ago" on each card.
 *
 * A phone left on this screen should not still claim the top event was added
 * to twenty minutes ago an hour later. Once a minute is the coarsest interval
 * that keeps every string it renders true, and the interval is cleared on
 * unmount so a backgrounded app is not waking to re-render a list nobody is
 * looking at.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Page 1 — what is happening, most recently active first. */
export function HomeTab({
  api,
  events,
  loading,
  t,
  onOpen,
  onRefresh,
  onCreate,
  onOpenLink,
  Button,
}: {
  api: Api;
  events: EventListing[];
  loading: boolean;
  t: TabTheme;
  onOpen: (event: EventListing) => void;
  onRefresh: () => Promise<void>;
  onCreate: () => void;
  /** The link, the QR code and the spoken phrase — all three doors, one screen. */
  onOpenLink: () => void;
  Button: ButtonComponent;
}) {
  const [refreshing, setRefreshing] = useState(false);
  // One gesture refreshes both: pulling the list down and finding the count
  // above it stale would make the count the thing nobody trusts.
  const [pulled, setPulled] = useState(0);
  const now = useNow();

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.dim}
          onRefresh={async () => {
            setRefreshing(true);
            setPulled((n) => n + 1);
            await onRefresh();
            setRefreshing(false);
          }}
        />
      }
    >
      {/*
        "Start one" sits on the title's baseline rather than being a button at
        the end of the list. It is the one thing someone arriving with nothing
        needs, and at the bottom of a long list it is the one place they will
        not look.
      */}
      <View style={styles.headRow}>
        <Text style={[styles.h1, { color: t.fg }]}>Events</Text>
        {/*
          Two actions, and the order is the argument: most people arrive
          holding a link somebody sent them, and the second one is the screen
          that takes it — along with a QR code and a spoken phrase.

          It used to be a pill of its own pinned above the tab bar, on every
          tab. Being sent a link is how most people arrive, so it was never
          more than one tap away — but the price was a permanent second bar
          across the bottom of every screen, announcing a door most people
          walk through once. It is one tap from here, which is where somebody
          who has just been sent something is looking.
        */}
        <View style={styles.headActions}>
          <Pressable onPress={onOpenLink} accessibilityRole="button">
            <Text style={[styles.headAction, { color: t.accent }]}>Open a link</Text>
          </Pressable>
          <Pressable onPress={onCreate} accessibilityRole="button">
            <Text style={[styles.headAction, { color: t.accent }]}>Start one</Text>
          </Pressable>
        </View>
      </View>

      {/*
        Above the list, because it is the one thing here somebody has to do
        something about — everything below is theirs already.
      */}
      <RequestBubble
        api={api}
        t={t}
        refreshKey={pulled}
        // Accepting an invitation adds an event, and the list under it is
        // holding the old answer until something says so.
        onAnswered={() => void onRefresh()}
      />

      {loading && events.length === 0 && <ActivityIndicator color={t.accent} />}

      {!loading && events.length === 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.body, { color: t.fg }]}>
            Nothing here yet. Events you are sent, or make, show up here — use
            Open a link above for one somebody has sent you.
          </Text>
          <Button label="Create Event" onPress={onCreate} t={t} primary />
        </View>
      )}

      {events.map((event, i) => (
        <EventCard
          key={event.id}
          event={event}
          // Computed here, once, from a single `now`: formatting inside each
          // card would let two cards rendered a tick apart disagree about
          // where the minute boundary was. `newest` on the first only — at the
          // top of the list "added to 20m ago" is what makes someone open it.
          meta={metaFor(event, { newest: i === 0, now })}
          t={t}
          onPress={() => onOpen(event)}
        />
      ))}

      {/* Deliberately not repeated at the foot: "Start one" is on the title
          row above, and two buttons for one action on a scrolling list is
          furniture rather than affordance. */}
    </ScrollView>
  );
}

/**
 * Page 2 — finding things.
 *
 * Three parts, and they differ in kind rather than in subject. Group search
 * and handle search both reach past what this person already has, and both are
 * deliberately narrow: a findable group comes back as a name and a member
 * count, never what is inside, and a person comes back as a handle and
 * whatever name they chose to show, by prefix, so somebody is findable enough
 * to be *asked* and no further. §3's rule holds — groups can be findable,
 * photos never are — so there is no event search here, and adding one would
 * make people's photographs discoverable by strangers.
 *
 * The map part is the opposite: it reaches only events this person is already
 * in, arranged by where they were. Nothing is discovered, and nothing is
 * exposed that they could not already see.
 */
/**
 * The lens a group's tile is drawn in, and the letter on it.
 *
 * By a stable hash of the id so a group keeps its colour between launches — a
 * list whose colours reshuffle every time it loads is decoration rather than a
 * way of telling two rooms apart. The same four-lens palette the mark is drawn
 * from, and the same rule the web's Groups page follows.
 *
 * Never a photograph. A group has no cover of its own, and the only pictures
 * available are inside events that belong to it — putting one on the door
 * shows something from a room on the screen that is merely the way in.
 */
const GROUP_LENSES = [
  { fill: '#ffb3b8', ink: '#7a4f52' },
  { fill: '#9db2f0', ink: '#33477f' },
  { fill: '#a5dcc6', ink: '#3f6b57' },
  { fill: '#f3b584', ink: '#7d5230' },
  { fill: '#c79ad9', ink: '#5f3f70' },
] as const;

function lensFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_LENSES[hash % GROUP_LENSES.length]!;
}

/**
 * The rooms you are in — the same screen the web grew, on a phone.
 *
 * Groups were a card inside You, under the name field and above the event
 * lists, which put the thing the product treats as persistent identity in a
 * drawer with the settings. They are a tab now, between Events and Find, in
 * the order those are true in: Events is what has already happened, Groups is
 * the rooms you are already in, Find is the only tab that goes looking for
 * something you are not part of yet.
 *
 * ## There is no Create group button, and that is the design
 *
 * `POST /api/groups` requires a `fromEventId` and refuses without one: a group
 * is something you notice afterwards, when the same people keep turning up, so
 * you roll one of your events into a group. An empty group you then have to
 * fill is a distribution problem with no photographs in it, and the people you
 * would invite have no reason to accept yet. The empty state says where groups
 * come from instead of offering a button that would have to be disabled.
 */
export function GroupsTab({
  api,
  t,
  onOpenGroup,
  onGoToEvents,
}: {
  api: Api;
  t: TabTheme;
  onOpenGroup: (groupId: string) => void;
  /** The empty state's one action: a group is made from an event. */
  onGoToEvents: () => void;
}) {
  const [groups, setGroups] = useState<MyGroupDetail[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setGroups(await api.myGroupsDetailed().catch(() => []));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.dim} />
      }
    >
      <Text style={[styles.h1, { color: t.fg }]}>Groups</Text>

      {groups === null ? (
        <ActivityIndicator color={t.accent} />
      ) : groups.length === 0 ? (
        /*
          Where groups come from, rather than a control that cannot work.
          Somebody here with none has not failed at anything — they have not
          yet had the second evening with the same people, which is the moment
          a group is for.
        */
        <View style={{ gap: 12 }}>
          <Text style={[styles.label, { color: t.fg }]}>
            You are not in any groups yet.
          </Text>
          <Text style={[styles.body, { color: t.dim }]}>
            A group is made from an event, not from nothing — when the same
            people keep turning up, you roll one of your events into a group and
            everybody in it stays in the loop for the next one. Open an event
            you made and look for Make a group.
          </Text>
          <Pressable
            onPress={onGoToEvents}
            accessibilityRole="button"
            accessibilityLabel="Go to your events"
          >
            <Text style={[styles.headAction, { color: t.accent }]}>Your events</Text>
          </Pressable>
        </View>
      ) : (
        groups.map((group) => {
          const lens = lensFor(group.id);
          return (
            <Pressable
              key={group.id}
              style={styles.groupRow}
              onPress={() => onOpenGroup(group.id)}
              accessibilityRole="button"
              accessibilityLabel={`${group.name}, ${groupMeta(group)}`}
            >
              <View style={[styles.groupTile, { backgroundColor: lens.fill }]}>
                <Text style={[styles.groupInitial, { color: lens.ink }]}>
                  {group.name.trim().slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.groupName, { color: t.fg }]} numberOfLines={1}>
                  {group.name}
                </Text>
                <Text style={[styles.small, { color: t.dim }]}>{groupMeta(group)}</Text>
              </View>
              {/* Admin only. "Member" on every other row is a word that
                  appears so often it stops being read. */}
              {group.role === 'admin' && (
                <Text style={[styles.small, { color: t.dim }]}>Admin</Text>
              )}
            </Pressable>
          );
        })
      )}

      {/*
        Where the other kind of group is. Discovery lives on Find and stays
        there — this tab is the rooms you are in, and a second list of rooms
        you are not would make it two screens wearing one title.
      */}
      {groups !== null && groups.length > 0 && (
        <Text style={[styles.small, { color: t.dim, paddingTop: 6 }]}>
          Looking for one you are not in? Find searches groups that have chosen
          to be findable — you would still be asking to be let in.
        </Text>
      )}
    </ScrollView>
  );
}

/** "3 events · 12 people · added to 2 days ago". */
function groupMeta(group: MyGroupDetail): string {
  const parts = [plural(group.eventCount, 'event'), plural(group.memberCount, 'person', 'people')];
  // Only when there is something to have been active about. "added to never"
  // is a sentence about an absence the count before it already states.
  if (group.lastActiveAt) parts.push(`added to ${ago(group.lastActiveAt)}`);
  return parts.join(' · ');
}

/**
 * How long ago, roughly.
 *
 * Computed on the device, unlike the web's, and that is the right call here
 * rather than an inconsistency: there is no server-rendered HTML to disagree
 * with, so nothing can mismatch — and a screen somebody leaves open should
 * update when they pull to refresh rather than showing the age it had when the
 * response was written.
 */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours < 1) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return plural(weeks, 'week') + ' ago';
  const months = Math.floor(days / 30);
  return plural(months, 'month') + ' ago';
}

export function SearchTab({
  api,
  events,
  t,
  onOpen,
  onOpenGroup,
  onOpenPerson,
}: {
  api: Api;
  events: EventListing[];
  t: TabTheme;
  onOpen: (event: EventListing) => void;
  onOpenGroup: (groupId: string) => void;
  onOpenPerson: (handle: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { id: string; name: string; memberCount: number }[]
  >([]);
  const [handle, setHandle] = useState('');
  const [people, setPeople] = useState<InvitablePerson[]>([]);

  const search = useCallback(
    async (next: string) => {
      setQuery(next);
      // Two characters is the server's floor. Below it there is nothing to
      // ask for, and asking per keystroke is a request per keystroke.
      if (next.trim().length < 2) return setResults([]);
      setResults(await api.searchGroups(next).catch(() => []));
    },
    [api],
  );

  /*
   * The same shape, against the other namespace.
   *
   * A failed lookup empties the list rather than leaving the last one up:
   * unlike the home screen's count, a stale result here is a row somebody is
   * about to tap, and tapping it would open a page for a search they have
   * already changed.
   */
  const searchPeople = useCallback(
    async (next: string) => {
      setHandle(next);
      if (next.trim().length < 2) return setPeople([]);
      setPeople(await api.findPeople(next).catch(() => []));
    },
    [api],
  );

  /** Events that know where they were, newest place first. */
  const places = useMemo(() => {
    const byPlace = new Map<string, EventListing[]>();
    for (const event of events) {
      if (!event.place) continue;
      byPlace.set(event.place, [...(byPlace.get(event.place) ?? []), event]);
    }
    return [...byPlace.entries()];
  }, [events]);

  const unplaced = events.filter((a) => !a.place).length;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={[styles.h1, { color: t.fg }]}>Find</Text>

      {/*
        Somebody, by handle — the way into their page.
        
        Its own card rather than one box over both, which is what the web does
        now: this tab is built as a card per kind and folding them together is
        a redesign of the tab rather than an addition to it.
      */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Somebody, by handle</Text>
        <TextInput
          value={handle}
          onChangeText={searchPeople}
          placeholder="Their handle"
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Find somebody by handle"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        {/*
          There used to be a card further down that said this and offered no
          box: it had been rewritten twice as the product moved under it, from
          "an account is an email address and nothing else" to "there is nobody
          to find". A paragraph describing a search, above no search, is the
          same overexplaining the web page had — so it says it here, once,
          under the thing it is about.
        */}
        <Text style={[styles.small, { color: t.dim }]}>
          By the start of a handle, and only that. A search returns a handle
          and a name — never their events, their photos, or who else they know.
        </Text>
        {people.map((person) => (
          <Pressable
            key={person.actorId}
            style={styles.row}
            disabled={!person.handle}
            onPress={() => person.handle && onOpenPerson(person.handle)}
          >
            {/*
              The face `/api/people` sends now, and the letter when somebody
              has none. A row of handles is a list to read; the picture is what
              makes it one to recognise, which is the point of a search for a
              person rather than for a word.
            */}
            {person.avatar ? (
              <Image
                source={{ uri: person.avatar }}
                style={[styles.rowFace, { backgroundColor: t.line }]}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.rowFace, styles.rowFaceBlank, { backgroundColor: t.line }]}>
                <Text style={[styles.small, { color: t.dim }]}>
                  {(person.displayName?.trim() || person.handle || '?')
                    .replace(/^@/, '')
                    .slice(0, 1)
                    .toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={[styles.body, { color: t.accent, flex: 1 }]}>
              {person.displayName?.trim() || `@${person.handle}`}
            </Text>
            {person.displayName?.trim() && person.handle && (
              <Text style={[styles.small, { color: t.dim }]}>@{person.handle}</Text>
            )}
          </Pressable>
        ))}
        {handle.trim().length >= 2 && people.length === 0 && (
          <Text style={[styles.body, { color: t.dim }]}>No handle starts with that.</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>A group, by name</Text>
        <TextInput
          value={query}
          onChangeText={search}
          placeholder="Sunday roast"
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search for a group by name"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Text style={[styles.small, { color: t.dim }]}>
          Groups can be findable. Events and photos never are — the only way
          into one is being sent it.
        </Text>
        {results.map((group) => (
          <Pressable
            key={group.id}
            style={styles.row}
            onPress={() => onOpenGroup(group.id)}
          >
            <Text style={[styles.body, { color: t.accent }]}>{group.name}</Text>
            <Text style={[styles.small, { color: t.dim }]}>
              {plural(group.memberCount, 'member')}
            </Text>
          </Pressable>
        ))}
        {query.trim().length >= 2 && results.length === 0 && (
          <Text style={[styles.body, { color: t.dim }]}>Nothing by that name.</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Your events, by place</Text>
        {places.length === 0 ? (
          <Text style={[styles.body, { color: t.dim }]}>
            None of your events say where they were yet. Whoever starts one can
            add a place, and it shows up here.
          </Text>
        ) : (
          places.map(([place, inPlace]) => (
            <View key={place} style={styles.placeBlock}>
              <View style={styles.row}>
                <Text style={[styles.label, { color: t.fg, flex: 1 }]}>{place}</Text>
                <Pressable
                  hitSlop={8}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${place} in Maps`}
                  // The system map rather than an embedded one. A map view is a
                  // native module this codebase cannot test, and handing the
                  // place to the maps app someone already uses gets them
                  // directions as well as a pin.
                  onPress={() =>
                    void Linking.openURL(
                      `https://maps.apple.com/?q=${encodeURIComponent(place)}`,
                    )
                  }
                >
                  <Text style={[styles.small, { color: t.accent }]}>Map ›</Text>
                </Pressable>
              </View>
              {inPlace.map((event) => (
                <Pressable
                  key={event.id}
                  style={styles.row}
                  onPress={() => onOpen(event)}
                >
                  <Text style={[styles.body, { color: t.accent }]}>{event.name}</Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
        {unplaced > 0 && places.length > 0 && (
          <Text style={[styles.small, { color: t.dim }]}>
            {plural(unplaced, 'event')} without a place.
          </Text>
        )}
      </View>

    </ScrollView>
  );
}

/**
 * Signing in — design §3, and the only reason accounts exist here.
 *
 * "Optional, asked for only after value has been delivered." An account holds
 * an email address and grants nothing an actor does not already have: its one
 * job is that a new phone is still you, which a credential in a keychain
 * cannot manage on its own. So it lives at the bottom of the profile tab and
 * nothing anywhere prompts for it.
 *
 * A code rather than a link, because mail often opens on a different device
 * from the one signing in — and setting up a new phone is exactly when that
 * happens.
 */
/**
 * Signing in, and the account once you have.
 *
 * Exported because three places now refuse without an account — creating an
 * event, adding photos, and a spoken code — and each wants the form in front
 * of the person rather than a sentence pointing at another tab. Those callers
 * pass `gate`, which drops the signed-in half: an upload prompt is no place
 * for a delete-account button.
 */
export function AccountCard({
  api,
  t,
  Button,
  onSignedIn,
  onSignedOut,
  why,
  gate = false,
}: {
  api: Api;
  t: TabTheme;
  Button: ButtonComponent;
  onSignedIn: () => void;
  /**
   * Give the device back. Only the profile tab passes it — the gated callers
   * are standing in front of an upload, and a sign-out button there is a way
   * to lose what you came to do.
   */
  onSignedOut?: () => void;
  /** What the person was trying to do, in their words rather than the policy's. */
  why?: string;
  /** Render nothing once signed in, for callers standing in front of an action. */
  gate?: boolean;
}) {
  const [account, setAccount] = useState<{ email: string } | null | undefined>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .account()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [api]);

  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestSignIn(email.trim());
      setSent(true);
    } catch {
      // The server answers the same however it went, so the only thing that
      // can be reported here is that the request itself did not land.
      setError('Could not ask for a code. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, email]);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.completeSignIn(email.trim(), code);
      setAccount({ email: result.email });
      setSent(false);
      setCode('');
      if (result.merged) {
        // Said out loud rather than swapped silently: everything they added
        // on this phone has just become part of another identity, and that is
        // the point of signing in but it should not be a surprise.
        Alert.alert(
          'Signed in',
          'This phone has joined your account. Everything you added here is now part of it.',
        );
      }
      onSignedIn();
    } catch {
      setError('That code did not work. Codes expire after ten minutes.');
    } finally {
      setBusy(false);
    }
  }, [api, code, email, onSignedIn]);

  /**
   * Signing out, with the cost said out loud first.
   *
   * The count of waiting uploads is in the question rather than in a sentence
   * under the button, because it is the only part of this that cannot be
   * undone by signing back in — the events come back with the account, and
   * those photographs do not. They are still in the camera roll, which is why
   * this is a warning and not a refusal.
   */
  const signOut = useCallback(async () => {
    const waiting = (await loadQueue().catch(() => ({ items: [] }))).items.length;
    Alert.alert(
      'Sign out?',
      waiting > 0
        ? `This phone forgets you and the events it is holding links to. ${waiting} ${
            waiting === 1 ? 'photo' : 'photos'
          } waiting to upload will be dropped — they stay in your camera roll. Nothing else is deleted.`
        : 'This phone forgets you and the events it is holding links to. Nothing is deleted, and the same address signs back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOutDevice();
            // The client keeps the token in memory as well as the keychain,
            // and the next request would carry it happily.
            api.setToken(null);
            setAccount(null);
            onSignedOut?.();
          },
        },
      ],
    );
  }, [api, onSignedOut]);

  const remove = useCallback(() => {
    // Two separate things, and conflating them would take other people's
    // copies of an evening they were also at. Guideline 5.1.1(v) requires the
    // first; the second is offered beside it rather than folded into it.
    Alert.alert(
      'Delete your account?',
      'Your email address and this account are removed. The photos you added stay in their events and stay yours to remove.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            await api.deleteAccount(false).catch(() => {});
            setAccount(null);
          },
        },
        {
          text: 'Delete account and my photos',
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteAccount(true).catch(() => null);
            setAccount(null);
            if (result) {
              Alert.alert('Deleted', `${result.photos} photos removed.`);
            }
          },
        },
      ],
    );
  }, [api]);

  if (account === undefined) return null;

  if (account) {
    if (gate) return null;
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Signed in</Text>
        <Text style={[styles.body, { color: t.dim }]}>{account.email}</Text>
        <Text style={[styles.small, { color: t.dim }]}>
          Your events and groups follow you to a new phone. That is all an
          account does here.
        </Text>
        {/* Sign out above delete, and only one of them is permanent. Both are
            plain buttons — a filled one here would be the loudest thing on a
            tab whose point is the events. */}
        {onSignedOut && <Button label="Sign out" onPress={signOut} t={t} />}
        <Button label="Delete account" onPress={remove} t={t} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>
        {why ?? 'Keep these on a new phone'}
      </Text>
      <Text style={[styles.small, { color: t.dim }]}>
        {why
          ? 'No password — a code goes to your inbox, and your events follow you to another device.'
          : 'Optional. Add an email and your events and groups follow you to another device. No password — a code goes to your inbox.'}
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Your email address"
        style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
      />

      {sent && (
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="6-digit code"
          placeholderTextColor={t.dim}
          keyboardType="number-pad"
          // Lets iOS offer the code straight from the notification.
          textContentType="oneTimeCode"
          autoFocus
          accessibilityLabel="The code from your email"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
      )}

      {error && <Text style={[styles.small, { color: t.dim }]}>{error}</Text>}

      <Button
        label={busy ? 'Working…' : sent ? 'Sign in' : 'Send me a code'}
        onPress={sent ? verify : request}
        disabled={busy || (sent ? code.length < 6 : !email.includes('@'))}
        t={t}
        primary
      />
      {sent && (
        <Text style={[styles.small, { color: t.dim }]}>
          Sent, if that address is one we can reach. It works once and expires
          in ten minutes — check spam if it is not there.
        </Text>
      )}
    </View>
  );
}

/** Page 3 — everything you are in, by group. */
export function ProfileTab({
  api,
  events,
  displayName,
  t,
  onOpen,
  onRename,
  onSignedIn,
  onSignedOut,
  Button,
}: {
  api: Api;
  events: EventListing[];
  displayName: string | null;
  t: TabTheme;
  onOpen: (event: EventListing) => void;
  onRename: (name: string) => void;
  onSignedIn: () => void;
  onSignedOut: () => void;
  Button: ButtonComponent;
}) {
  const [name, setName] = useState(displayName ?? '');

  const grouped = useMemo(() => events.filter((a) => a.groupId), [events]);
  const loose = useMemo(() => events.filter((a) => !a.groupId), [events]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={[styles.h1, { color: t.fg }]}>You</Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>What people see</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => onRename(name.trim())}
          placeholder="Your name (optional)"
          placeholderTextColor={t.dim}
          maxLength={60}
          accessibilityLabel="The name shown beside your uploads"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Text style={[styles.small, { color: t.dim }]}>
          Optional, and it is what people see beside your photos rather than
          who you are to us — that is the account below.
        </Text>
      </View>

      {/*
        No Groups card here any more. It listed the same rooms the Groups tab
        now holds, one tap away and under the name field — the drawer version
        of the thing the product treats as persistent identity. What stays is
        the two event lists below, which are about events rather than groups.
      */}

      {grouped.length > 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.label, { color: t.fg }]}>In your groups</Text>
          {grouped.map((event) => (
            <Pressable key={event.id} style={styles.row} onPress={() => onOpen(event)}>
              <Text style={[styles.body, { color: t.accent, flex: 1 }]}>{event.name}</Text>
              <Text style={[styles.small, { color: t.dim }]}>{event.groupName}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>One-offs</Text>
        {loose.length === 0 ? (
          <Text style={[styles.body, { color: t.dim }]}>Nothing here.</Text>
        ) : (
          loose.map((event) => (
            <Pressable key={event.id} style={styles.row} onPress={() => onOpen(event)}>
              <Text style={[styles.body, { color: t.accent }]}>{event.name}</Text>
            </Pressable>
          ))
        )}
      </View>

      <AccountCard
        api={api}
        t={t}
        Button={Button}
        onSignedIn={onSignedIn}
        onSignedOut={onSignedOut}
      />

      <Button
        label="Safety, reporting and contact"
        t={t}
        onPress={() => void Linking.openURL('https://parea.photos/safety')}
      />
    </ScrollView>
  );
}

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: TabTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

const styles = StyleSheet.create({
  /* Room for the tab bubble, which floats over this rather than sitting under
     it: 28pt of gap plus 64pt of bubble, and a card's own margin past that.
     It was 150 while a second pill floated above the bubble, and 40 before
     either — which was already too little, so the last card on every tab
     ended up underneath the chrome. */
  scroll: { padding: 20, paddingTop: 72, paddingBottom: 110, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  /* Two of them now, so they need a row of their own rather than each being a
     child of the space-between. Wide enough apart to be two targets. */
  headActions: { flexDirection: 'row', alignItems: 'baseline', gap: 18 },
  headAction: { fontSize: 14, fontWeight: '600' },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  // Rounded, tall, one per row: the shape people scroll through.
  event: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  mosaic: { flexDirection: 'row', gap: 2, height: 132 },
  tile: { flex: 1, width: '100%', backgroundColor: '#8881' },
  eventBody: { position: 'relative', overflow: 'hidden' },
  /* Inset past every edge so the blur has bleed and no soft edge shows. */
  bleed: {
    position: 'absolute',
    top: -24,
    left: -24,
    right: -24,
    bottom: -24,
    flexDirection: 'row',
    transform: [{ scaleY: -1 }],
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  eventText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  /* No mosaic above it, so the strip carries the whole card and needs the
     breathing room the photos would otherwise have given it. */
  eventTextBare: { paddingVertical: 18 },
  eventCount: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  eventName: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  /* A row rather than a card. The Find tab draws a group as a bordered card
     because each one there is a decision — a door, with a button on it. These
     are rooms you are already in, so the row is a way through, and a stack of
     boxes would make walking into your own group look like an application. */
  /* The face on a search result: a rounded square, like the event thumbs above
     it, rather than a circle — these rows sit in the same list as events. */
  rowFace: { width: 34, height: 34, borderRadius: 10, marginRight: 12 },
  rowFaceBlank: { alignItems: 'center', justifyContent: 'center' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  groupTile: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  groupInitial: { fontSize: 18, fontWeight: '600' },
  groupName: { fontSize: 17, fontWeight: '600' },
  placeBlock: { gap: 2, paddingTop: 4 },
});
