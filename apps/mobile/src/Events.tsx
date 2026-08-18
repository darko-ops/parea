/**
 * The three tabs' contents: home, search, profile.
 *
 * One word for one thing: an event. These tabs briefly said "album" while the
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

import type { Api, EventListing } from './api';
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
  Button,
}: {
  api: Api;
  events: EventListing[];
  loading: boolean;
  t: TabTheme;
  onOpen: (event: EventListing) => void;
  onRefresh: () => Promise<void>;
  onCreate: () => void;
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
        <Pressable onPress={onCreate} accessibilityRole="button">
          <Text style={[styles.headAction, { color: t.accent }]}>Start one</Text>
        </Pressable>
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
            Nothing here yet. Events you are sent, or make, show up here.
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
  const [people, setPeople] = useState<
    { actorId: string; handle: string | null; displayName: string | null }[]
  >([]);

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
        ? `This phone forgets you and the albums it is holding links to. ${waiting} ${
            waiting === 1 ? 'photo' : 'photos'
          } waiting to upload will be dropped — they stay in your camera roll. Nothing else is deleted.`
        : 'This phone forgets you and the albums it is holding links to. Nothing is deleted, and the same address signs back in.',
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
            tab whose point is the albums. */}
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
  groups,
  displayName,
  t,
  onOpen,
  onOpenGroup,
  onRename,
  onSignedIn,
  onSignedOut,
  Button,
}: {
  api: Api;
  events: EventListing[];
  groups: { id: string; name: string; role: 'member' | 'admin' }[];
  displayName: string | null;
  t: TabTheme;
  onOpen: (event: EventListing) => void;
  onOpenGroup: (groupId: string) => void;
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

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>
          Groups {groups.length > 0 && `(${groups.length})`}
        </Text>
        {groups.length === 0 ? (
          <Text style={[styles.body, { color: t.dim }]}>
            None yet. A group is what an event becomes when the same people keep
            doing things together.
          </Text>
        ) : (
          groups.map((group) => (
            <Pressable
              key={group.id}
              style={styles.row}
              onPress={() => onOpenGroup(group.id)}
            >
              <Text style={[styles.body, { color: t.accent, flex: 1 }]}>{group.name}</Text>
              {group.role === 'admin' && (
                <Text style={[styles.small, { color: t.dim }]}>admin</Text>
              )}
            </Pressable>
          ))
        )}
      </View>

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
  scroll: { padding: 20, paddingTop: 72, paddingBottom: 40, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
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
  placeBlock: { gap: 2, paddingTop: 4 },
});
