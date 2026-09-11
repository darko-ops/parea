/**
 * Three of the four tabs' contents: home, groups and find. You is its own file.
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

import { ago, dateLabel, CARD_FACES, isLive } from '@parea/cards';
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

import type {
  Api,
  Cluster,
  ClusterPerson,
  EventListing,
  InvitablePerson,
  MyGroupDetail,
} from './api';
import { ClusterCard, CreateGroupForm } from './CreateGroup';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { loadQueue, signOutDevice } from './platform';
import { RequestBubble } from './Requests';

export type TabTheme = GroupTheme;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One event, led by the photograph it was given.
 *
 * The same card the web draws, and it took the same route to get here: a
 * mosaic of the four most recent photos over a strip whose background was
 * those same photos again, mirrored and blurred, under a scrim. Handsome, and
 * it made a wall of evenings look like a wall of listings — four thumbnails
 * too small to recognise anybody in, plus a panel of chrome around them.
 *
 * What replaced them is one picture and the people. A tall cover, the faces of
 * whoever was there overlapping its bottom edge, and two lines underneath. No
 * border, no card, no strip: the photograph *is* the card.
 *
 * The faces overlap on purpose. A row of circles floating below a picture
 * reads as metadata; the same row half over it reads as who was there, which
 * is how somebody actually recognises an evening.
 *
 * The photograph count is gone from the face of it and kept in the
 * accessibility label, because "how many photographs" is a fact somebody
 * navigating by screen reader has no other way to get.
 *
 * `ago`, `dateLabel`, `isLive` and `CARD_FACES` come from `@parea/cards`. The
 * words around them are this file's, and what is shared is the part that could
 * ever disagree: two clients rounding "2 days ago" separately drift, and
 * nothing fails when they do.
 */
function EventCard({
  event,
  now,
  t,
  onPress,
}: {
  event: EventListing;
  /** One clock for every card on screen, so none disagree about the minute. */
  now: Date;
  t: TabTheme;
  onPress: () => void;
}) {
  const label = `${event.name}, ${plural(event.photoCount, 'photo')}`;

  /*
   * Nothing in it is a different card, not this card with the picture missing.
   *
   * What it has to do is get the first photograph out of somebody, so it is
   * mostly a button, and the lens cluster is the argument for pressing it: two
   * circles filled and the third one dashed and empty, the empty one being
   * you.
   *
   * On the photograph count rather than on the cover. An event can have a
   * cover and nothing in it yet — the host chose a picture before anybody
   * added one — and leading with it would replace the only card in the product
   * whose job is to ask with a card that says nothing.
   */
  if (event.photoCount === 0) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.empty, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eventName, { color: t.fg }]} numberOfLines={1}>
            {event.name}
          </Text>
          {event.caption && (
            <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
              {event.caption}
            </Text>
          )}
          <Text style={[styles.body, { color: t.dim }]}>{emptyLine(event.memberCount)}</Text>
        </View>

        <View style={styles.emptyLenses} pointerEvents="none">
          <View style={[styles.emptyLens, { backgroundColor: EMPTY_LENSES[0] }]} />
          <View style={[styles.emptyLens, { backgroundColor: EMPTY_LENSES[1] }]} />
          <View style={[styles.emptyLens, styles.emptySlot, { borderColor: t.accent }]}>
            <Text style={[styles.emptySlotMark, { color: t.accent }]}>＋</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const live = isLive(event.lastActiveAt, now);
  const faces = event.faces.slice(0, CARD_FACES);
  const moreFaces = Math.max(0, event.memberCount - faces.length);
  const date = dateLabel(event.eventDate ?? event.startsAt ?? event.firstPhotoAt);
  const host = event.mine ? 'You' : event.creator.name;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.cover}>
        {event.cover && (
          <Image
            source={{ uri: event.cover.src }}
            style={styles.coverShot}
            contentFit="cover"
            transition={120}
          />
        )}
        {/*
          Only while it is true, which is an hour — see `isLive`. A badge that
          stays up all day is a badge nobody reads, and "being added to now" is
          the one claim on this screen worth interrupting a photograph for.
        */}
        {live && (
          <View style={[styles.liveTag, { backgroundColor: t.card }]}>
            <View style={[styles.liveDot, { backgroundColor: t.accent }]} />
            <Text style={[styles.liveText, { color: t.fg }]}>Being added to now</Text>
          </View>
        )}
      </View>

      {faces.length > 0 && (
        <View style={styles.faces}>
          {faces.map((face, i) => (
            <View
              key={`${face.actorId}-${i}`}
              style={[styles.face, { borderColor: t.bg, backgroundColor: t.line }]}
            >
              {face.avatarUrl ? (
                <Image
                  source={{ uri: face.avatarUrl }}
                  style={styles.faceShot}
                  contentFit="cover"
                />
              ) : (
                <Text style={[styles.faceLetter, { color: t.dim }]}>
                  {(face.name || '?').replace(/^@/, '').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
          ))}
          {moreFaces > 0 && (
            <View style={[styles.face, styles.faceMore, { borderColor: t.bg, backgroundColor: t.line }]}>
              <Text style={[styles.faceLetter, { color: t.dim }]}>+{moreFaces}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.under}>
        <Text style={[styles.eventName, { color: t.fg }]} numberOfLines={1}>
          {event.name}
        </Text>
        {/*
          Whose event it is, in their own two names — both, always. The name is
          what somebody recognises and the handle is what is unique, so
          printing one makes the reader guess which they have. On your own
          events the name is "You": your own name read back at you on a wall of
          your own evenings is the screen describing you to yourself.
        */}
        {(host || event.creator.handle) && (
          <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
            {host}
            {host && event.creator.handle ? '  ' : ''}
            {event.creator.handle ? `@${event.creator.handle}` : ''}
          </Text>
        )}
        {/*
          When first, then who — and at the same size as the host line above
          it rather than a step larger.

          The order is the change: the date is what tells one evening from
          another on a wall of them, and a count of people is the same shape of
          fact on every card, so leading with "6 people" put the interchangeable
          half first. The when is the evening itself rather than the upload,
          except while it is being added to, where the recent thing *is* the
          news and takes the slot.

          Sized with the host's name and handle because the three lines are one
          block: a name, then two quiet facts about it. At `body` this line
          competed with the title for the second-loudest thing on the card.

          Still no caption here: a second sentence under the name is what made
          a photograph look like a listing.
        */}
        <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
          {live ? `added to ${ago(new Date(event.lastActiveAt), now)}` : (date ?? '')}
          {live || date ? ' · ' : ''}
          {plural(event.memberCount, 'person', 'people')}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Who is in an event nobody has added to.
 *
 * Counted from the other side — "you and one other" rather than "2 people" —
 * because this card is asking the person reading it to do something, and the
 * sentence that asks is the one they are in. Same words as the web's.
 */
function emptyLine(memberCount: number): string {
  const others = Math.max(0, memberCount - 1);
  if (others === 0) return 'Just you so far. Nothing in it yet.';
  if (others === 1) return 'You and one other. Nothing in it yet.';
  return `You and ${others} others. Nothing in it yet.`;
}

/** Two of the mark's lenses, for the cluster on the card that has no photos. */
const EMPTY_LENSES = ['#ffb3b8', '#9db2f0'] as const;

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

  /*
   * Albums with nothing in them are not on this page.
   *
   * An empty album is a card that asks to be opened and then has nothing to
   * show — and most of them were never this person's doing: somebody made an
   * evening, added people, and the evening has not happened yet. A column of
   * those is the first thing the product's main screen said, on the tab whose
   * whole subject is photographs.
   *
   * `arrivingCount` counts too, so an album stays put between the upload
   * finishing and the deriver getting to it. Without that, adding the first
   * photograph to an album would make it disappear for the minute or so the
   * derivatives take and then come back, which is worse than either state.
   *
   * This hides your own empty albums as well. Making one still lands you
   * inside it — `onCreated` opens the event rather than returning to this
   * list — so the way in is the link, the group it belongs to, or adding the
   * photograph that puts it back here.
   */
  const filled = events.filter(
    (event) => event.photoCount > 0 || event.arrivingCount > 0,
  );

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

      {loading && filled.length === 0 && <ActivityIndicator color={t.accent} />}

      {!loading && filled.length === 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.body, { color: t.fg }]}>
            Nothing here yet. Events you are sent, or make, show up here — use
            Open a link above for one somebody has sent you.
          </Text>
          <Button label="Create Event" onPress={onCreate} t={t} primary />
        </View>
      )}

      {filled.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          // One clock, handed down: a card that read the time itself would let
          // two cards rendered a tick apart disagree about where the minute
          // boundary was. Every card shows the evening it happened on, and
          // recency only while it is being added to — so there is no longer a
          // "newest" case, which used to be the only row showing a time.
          now={now}
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
/*
 * The lens palette lives in `lens.ts` now.
 *
 * Four screens draw one of these — the group tiles here, the faces over an
 * event's cover, the avatars in a thread and the tiles in a search result —
 * and a second copy of the five colours is how the same group comes to be pink
 * in one list and green in another.
 */

/**
 * The rooms you are in, drawn as what is in them.
 *
 * This was a directory: a letter tile, a name, a line of counts, repeated. A
 * list of rooms with no photographs in it, on a tab of a product whose whole
 * subject is photographs — so the one screen that should have made somebody
 * want to open a group looked like a settings list of them.
 *
 * Each group is now its evenings: three recent covers under its name, and how
 * many more there are on the third one. The name and the date of the newest
 * event are the line under it, because "Sunday roast, added to 2 days ago,
 * Ana's birthday" is what tells you whether there is anything new in there.
 *
 * ## The door is still a letter
 *
 * The tile beside the name is a letter on the group's lens colour, hashed from
 * its id, and it stays that way: a group has no picture of its own, and giving
 * it one out of an event inside it would put a photograph from a room on the
 * thing that is merely the way in.
 *
 * The strip below it is not that, and the difference is where the pictures
 * come from. Those covers are read off `events` — this actor's own listing,
 * the albums they can already open — and never off the group. So a group shows
 * somebody the evenings *they* were at, three at a time; somebody who was
 * never in one of its events, or who has since been removed from it, has no
 * listing for it and sees an empty slot where that cover would be. The server
 * is not asked for a group's photographs and does not answer with any.
 *
 * ## Groups are made here, and what makes that safe
 *
 * This tab used to refuse a create action outright, and the argument was good:
 * a group is something you notice afterwards, and an empty group you then have
 * to fill is a distribution problem with no photographs in it.
 *
 * What changed is not the argument but what sits beside the button — the
 * people this actor keeps ending up in the same events as, from
 * `/api/groups/clusters`. Creating is confirming a set of people who already
 * exist rather than inventing one. The suggestion is one quiet line above a
 * rule now rather than a card: it is a remark about the list above it, and a
 * bordered box gave it the weight of a room you are already in.
 *
 * The roll-up from an event has not gone anywhere; it is still in the event's
 * `⋯` sheet and still the only path that moves an event under a group.
 */
export function GroupsTab({
  api,
  events,
  t,
  openCreate = 0,
  onOpenGroup,
  onGoToEvents,
}: {
  api: Api;
  /**
   * This actor's own albums, for the covers under each group's name.
   *
   * Passed in rather than fetched: the tabs already hold this list, and it is
   * the list of what this person can reach — which is exactly the bound that
   * makes drawing a photograph here safe. See the note at the top.
   */
  events: EventListing[];
  t: TabTheme;
  /**
   * Bumped by somebody who asked to make a group from another tab.
   *
   * A counter rather than a boolean: the profile's `+` can be pressed twice,
   * and the second press has to open the form again after the first was
   * cancelled — which a flag that is already `true` cannot say. The form
   * itself stays here because this is where the suggestions are.
   */
  openCreate?: number;
  onOpenGroup: (groupId: string) => void;
  /** Where somebody with nothing to recognise yet is sent. */
  onGoToEvents: () => void;
}) {
  const [groups, setGroups] = useState<MyGroupDetail[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [also, setAlso] = useState<ClusterPerson[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  /*
   * Which card is open as a form, or `'anyone'` for the one `New group` opens
   * with nobody in it. One at a time: two half-filled forms on one screen is
   * two things to cancel and a question about which Create belongs to which.
   */
  const [making, setMaking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mine, found] = await Promise.all([
      api.myGroupsDetailed().catch(() => []),
      api.clusters().catch(() => ({ clusters: [], also: [] })),
    ]);
    setGroups(mine);
    setClusters(found.clusters);
    setAlso(found.also);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Zero is the value nobody asked with — the tab opening normally, rather
  // than somebody arriving on it holding a press.
  useEffect(() => {
    if (openCreate > 0) setMaking('anyone');
  }, [openCreate]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /** This actor's albums, filed under the group they belong to, newest first. */
  const byGroup = useMemo(() => {
    const map = new Map<string, EventListing[]>();
    for (const event of events) {
      if (!event.groupId) continue;
      map.set(event.groupId, [...(map.get(event.groupId) ?? []), event]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    }
    return map;
  }, [events]);

  return (
    <ScrollView
      contentContainerStyle={styles.groupsScroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.dim} />
      }
    >
      <View style={styles.groupsHead}>
        <Text style={[styles.h1, { color: t.fg }]}>Groups</Text>
        {/*
          A filled disc rather than an outlined word.

          Here in every state, including the empty one: somebody with no groups
          is who most needs to know one can be made. It is a glyph now because
          the screen's heading row is a heading and one action, and "New group"
          set beside a 30pt title was a second thing to read on the way to the
          rooms underneath it.
        */}
        {groups !== null && making !== 'anyone' && (
          <Pressable
            onPress={() => setMaking('anyone')}
            accessibilityRole="button"
            accessibilityLabel="New group"
            style={({ pressed }) => [
              styles.newGroup,
              { backgroundColor: t.accent, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Glyph name="plus" size={20} color={t.onAccent} />
          </Pressable>
        )}
      </View>

      {making === 'anyone' && (
        <CreateGroupForm
          api={api}
          cluster={null}
          also={also}
          t={t}
          onCancel={() => setMaking(null)}
          onCreated={(id) => {
            setMaking(null);
            onOpenGroup(id);
          }}
        />
      )}

      {groups === null ? (
        <ActivityIndicator color={t.accent} />
      ) : groups.length === 0 && clusters.length === 0 ? (
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
            Groups are for the people who keep turning up — once you have shared
            a couple of events with the same faces, they show up here ready to
            keep together. Nothing to go on yet, so the button above is the way
            to start one.
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
        groups.map((group) => (
          <GroupBlock
            key={group.id}
            group={group}
            albums={byGroup.get(group.id) ?? []}
            t={t}
            onPress={() => onOpenGroup(group.id)}
          />
        ))
      )}

      {/*
        What the product noticed, as one line under everything it already knows
        about. Never more than two, and a cluster whose people are already
        gathered in one of these groups is dropped by the server — which is
        what lets this stay without needing a way to dismiss it.
      */}
      {clusters.map((cluster) =>
        making === cluster.key ? (
          <CreateGroupForm
            key={cluster.key}
            api={api}
            cluster={cluster}
            also={also}
            t={t}
            onCancel={() => setMaking(null)}
            onCreated={(id) => {
              setMaking(null);
              onOpenGroup(id);
            }}
          />
        ) : (
          <ClusterCard
            key={cluster.key}
            cluster={cluster}
            onMake={() => setMaking(cluster.key)}
            t={t}
          />
        ),
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

/**
 * One group: its door, its evenings, and what has just happened in it.
 *
 * Three blocks of one thing rather than a row — the covers are the reason this
 * screen exists now, and a strip 96 points tall is a photograph where a 44pt
 * thumbnail beside a name was a bullet point.
 */
function GroupBlock({
  group,
  albums,
  t,
  onPress,
}: {
  group: MyGroupDetail;
  /** This actor's own albums in this group, newest first. Never the group's. */
  albums: EventListing[];
  t: TabTheme;
  onPress: () => void;
}) {
  const lens = lensFor(group.id);
  const shown = albums.slice(0, COVER_STRIP);
  /*
   * How many evenings are not in the strip.
   *
   * Counted off the group's own `eventCount` rather than off `albums`, because
   * that is the honest number: it is what the room holds, and it is already
   * disclosed to every member — `groupEvents` lists all of them by name. The
   * strip shows the ones this person can open.
   */
  const more = Math.max(0, group.eventCount - shown.length);
  const newest = albums[0] ?? null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${plural(group.memberCount, 'person', 'people')}`}
      style={({ pressed }) => [styles.groupBlock, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.groupHeader}>
        {/*
          The door: a letter on the group's own colour, hashed from its id and
          the same on every screen and every device. Never a photograph — see
          the note at the top of the tab.
        */}
        <View style={[styles.groupTile, { backgroundColor: lens.fill }]}>
          <Text style={[styles.groupInitial, { color: lens.ink }]}>
            {initialOf(group.name)}
          </Text>
        </View>
        <Text style={[styles.groupName, { color: t.fg }]} numberOfLines={1}>
          {group.name}
        </Text>
        {/* Admin only. "Member" on every other row is a word that appears so
            often it stops being read. */}
        <Text style={[styles.groupMeta, { color: t.dim }]}>
          {plural(group.memberCount, 'person', 'people')}
          {group.role === 'admin' && ' · Admin'}
        </Text>
      </View>

      <View style={styles.strip}>
        {Array.from({ length: COVER_STRIP }, (_, i) => {
          const album = shown[i];
          const last = i === COVER_STRIP - 1;
          return (
            <View key={album?.id ?? `slot-${i}`} style={styles.stripTile}>
              {album?.cover ? (
                <Image
                  source={{ uri: album.cover.src }}
                  style={[styles.stripShot, { backgroundColor: t.line }]}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                /* Dashed, which reads as "nothing here" rather than as a very
                   dark photograph — the same call every empty tile in this
                   product makes. An evening this person cannot open leaves one
                   of these rather than borrowing a picture from the group. */
                <View style={[styles.stripShot, styles.stripEmpty, { borderColor: t.line }]} />
              )}
              {last && more > 0 && (
                <View style={styles.stripMore}>
                  <Text style={styles.stripMoreText}>+{more}</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/*
        What has just happened in it, which is the only reason to open one
        today rather than tomorrow. "added to never" is a sentence about an
        absence, so a group nobody has put anything in says that instead.
      */}
      <Text style={[styles.groupMeta, { color: t.dim }]} numberOfLines={1}>
        {group.lastActiveAt
          ? `Added to ${ago(new Date(group.lastActiveAt), new Date())}${
              newest ? ` · ${newest.name}` : ''
            }`
          : 'Nothing in it yet — anyone in it can start the first event.'}
      </Text>
    </Pressable>
  );
}

/** Three covers, and a count on the third. */
const COVER_STRIP = 3;

/**
 * Find — one field, scoped by chips.
 *
 * It was three bordered cards, each with a heading, each with a paragraph of
 * policy above it, two of them holding a text field. So a tab whose whole job
 * is a search asked somebody to pick which of two boxes to type in, and told
 * them what could not be searched three times before they had searched for
 * anything at all.
 *
 * Now: one field, three chips saying what it is searching, results as rows in
 * one list, and the policy said once at the foot — where it is read by
 * somebody who has just seen what came back, rather than as a preamble to an
 * empty screen.
 *
 * ## What has not changed
 *
 * Every rule the three cards enforced is still here, because none of them was
 * about the layout:
 *
 *   - **Two characters before anything is asked for.** The server's floor;
 *     below it there is nothing to ask for and asking per keystroke is a
 *     request per keystroke.
 *   - **A failed lookup empties the list.** A stale row here is one somebody
 *     is about to tap, and tapping it opens a page for a search they have
 *     already changed.
 *   - **Places is local.** It groups this person's own events by their place
 *     and hands the place to the maps app they already use. It queries
 *     nothing, which is why it can answer before two characters.
 *   - **Events and photographs are never searchable.** That is the sentence at
 *     the foot, and it is the product's line rather than this screen's.
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
  const [scope, setScope] = useState<Scope>('people');
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string; memberCount: number }[]>([]);
  const [people, setPeople] = useState<InvitablePerson[]>([]);

  /**
   * One box, and which namespace it is asking is the chip.
   *
   * Both lists are emptied on every keystroke below the floor and on every
   * failure, and the scope is what decides which of them is asked — switching
   * chips re-runs the same text against the other namespace rather than
   * clearing what somebody typed, which is the whole reason this is one field.
   */
  const search = useCallback(
    async (next: string, into: Scope) => {
      setQuery(next);
      // Two characters is the server's floor. Below it there is nothing to ask
      // for, and asking per keystroke is a request per keystroke.
      if (next.trim().length < 2) {
        setPeople([]);
        setGroups([]);
        return;
      }
      if (into === 'people') setPeople(await api.findPeople(next).catch(() => []));
      if (into === 'groups') setGroups(await api.searchGroups(next).catch(() => []));
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
    return [...byPlace.entries()].filter(
      ([place]) =>
        query.trim().length < 2 || place.toLowerCase().includes(query.trim().toLowerCase()),
    );
  }, [events, query]);

  const unplaced = events.filter((event) => !event.place).length;
  const asked = query.trim().length >= 2;

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={[styles.h1, { color: t.fg }]}>Find</Text>

      <View style={[styles.field, { backgroundColor: t.card, borderColor: t.line }]}>
        <Glyph name="search" size={17} color={t.dim} />
        <TextInput
          value={query}
          onChangeText={(next) => void search(next, scope)}
          placeholder={PLACEHOLDER[scope]}
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={`Find ${scope}`}
          style={[styles.fieldText, { color: t.fg }]}
        />
      </View>

      {/*
        What the box is asking, rather than which box to type in. The active
        chip is filled in the ink colour: this is the one control on the screen
        whose state changes what the rows below it mean, and an outline would
        make it the same weight as the two it is not.
      */}
      <View style={styles.chips}>
        {(
          [
            ['people', 'People'],
            ['groups', 'Groups'],
            ['places', 'Places'],
          ] as [Scope, string][]
        ).map(([id, label]) => {
          const on = scope === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                setScope(id);
                void search(query, id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: t.fg, borderColor: t.fg }
                  : { backgroundColor: t.card, borderColor: t.line },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  on && styles.chipTextOn,
                  { color: on ? t.bg : t.dim },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.results}>
        {scope === 'people' &&
          people.map((person, i) => (
            <Result
              key={person.actorId}
              first={i === 0}
              t={t}
              /* The face `/api/people` sends, and the letter on their lens when
                 somebody has none. A list of handles is a list to read; the
                 picture is what makes it one to recognise, which is the point
                 of searching for a person rather than for a word. */
              avatar={person.avatar}
              seed={person.handle ?? person.actorId}
              name={person.displayName?.trim() || `@${person.handle}`}
              under={person.displayName?.trim() && person.handle ? `@${person.handle}` : null}
              disabled={!person.handle}
              onPress={() => person.handle && onOpenPerson(person.handle)}
            />
          ))}

        {scope === 'groups' &&
          groups.map((group, i) => (
            <Result
              key={group.id}
              first={i === 0}
              t={t}
              avatar={null}
              seed={group.id}
              name={group.name}
              under={null}
              aside={plural(group.memberCount, 'member')}
              onPress={() => onOpenGroup(group.id)}
            />
          ))}

        {/*
          Places is this person's own events grouped by where they were, so it
          answers without asking anything of the server — which is also why the
          two-character floor does not apply to it. The place itself opens in
          the maps app somebody already uses: a map view is a native module
          this codebase cannot test, and handing over the name gets them
          directions as well as a pin.
        */}
        {scope === 'places' &&
          places.map(([place, inPlace], i) => (
            <View key={place}>
              <Result
                first={i === 0}
                t={t}
                avatar={null}
                seed={place}
                name={place}
                under={plural(inPlace.length, 'event')}
                aside="Map ›"
                onPress={() =>
                  void Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(place)}`)
                }
              />
              {inPlace.map((event) => (
                <Pressable
                  key={event.id}
                  style={styles.placeEvent}
                  onPress={() => onOpen(event)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.small, { color: t.accent }]}>{event.name}</Text>
                </Pressable>
              ))}
            </View>
          ))}
      </View>

      {/*
        Nothing came back, said once and only after something was asked. The
        wording is per scope because "no handle starts with that" is a fact
        about handles and would be a lie about places.
      */}
      {scope === 'people' && asked && people.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>No handle starts with that.</Text>
      )}
      {scope === 'groups' && asked && groups.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>Nothing findable by that name.</Text>
      )}
      {scope === 'places' && places.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>
          {events.length === 0 || unplaced === events.length
            ? 'None of your events say where they were yet. Whoever starts one can add a place, and it shows up here.'
            : 'No place of yours matches that.'}
        </Text>
      )}
      {scope === 'places' && unplaced > 0 && places.length > 0 && (
        <Text style={[styles.small, { color: t.dim }]}>
          {plural(unplaced, 'event')} without a place.
        </Text>
      )}

      {/*
        Once, at the foot.

        It used to be said above each of three cards, before anything had been
        searched for — which is a paragraph of policy in front of an empty
        screen, and the thing everybody scrolls past. Here it is read by
        somebody who has just seen what a search returns, which is the moment
        "and this is what it will never return" means anything.
      */}
      <Text style={[styles.footnote, { color: t.dim }]}>
        Handles and findable groups only. Events and photos are never
        searchable — the only way into one is being sent it.
      </Text>
    </ScrollView>
  );
}

/** Which namespace the one field is asking. */
type Scope = 'people' | 'groups' | 'places';

const PLACEHOLDER: Record<Scope, string> = {
  people: 'A handle, or the start of one',
  groups: 'A group by name',
  places: 'Somewhere you have been',
};

/**
 * One row of a result list.
 *
 * A row with a hairline above it rather than a card: three bordered boxes make
 * three results look like three decisions, and most of these are a name
 * somebody is scanning past on the way to the one they meant.
 */
function Result({
  first,
  t,
  avatar,
  seed,
  name,
  under,
  aside,
  disabled,
  onPress,
}: {
  /** The first row has no rule above it — there is nothing to divide it from. */
  first: boolean;
  t: TabTheme;
  avatar: string | null;
  /** What the lens colour is keyed on, when there is no picture. */
  seed: string;
  name: string;
  under: string | null;
  aside?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const lens = lensFor(seed);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.result,
        !first && { borderTopWidth: 1, borderTopColor: t.line },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {avatar ? (
        <Image
          source={{ uri: avatar }}
          style={[styles.resultFace, { backgroundColor: t.line }]}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View style={[styles.resultFace, styles.resultFaceBlank, { backgroundColor: lens.fill }]}>
          <Text style={[styles.resultLetter, { color: lens.ink }]}>{initialOf(name)}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.resultName, { color: t.fg }]} numberOfLines={1}>
          {name}
        </Text>
        {under && (
          <Text style={[styles.resultUnder, { color: t.dim }]} numberOfLines={1}>
            {under}
          </Text>
        )}
      </View>
      {aside && <Text style={[styles.resultUnder, { color: t.dim }]}>{aside}</Text>}
    </Pressable>
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
  /* The photograph is the card: no border, no panel, no strip of chrome. What
     used to be `event` was a bordered box around a mosaic and a detail strip;
     what is left is a tall picture, some faces over its edge, and two lines. */
  cover: { borderRadius: 18, overflow: 'hidden', height: 260, backgroundColor: '#8881' },
  coverShot: { width: '100%', height: '100%' },
  /* Over the picture's bottom edge, not under it — see the note on the card.
     The negative margin is the overlap, and the row sits above the text it
     shares a column with. */
  faces: { flexDirection: 'row', marginTop: -18, marginLeft: 14, marginBottom: 2 },
  face: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    marginRight: -8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceShot: { width: '100%', height: '100%' },
  faceLetter: { fontSize: 12, fontWeight: '700' },
  faceMore: { paddingHorizontal: 2 },
  under: { paddingHorizontal: 4, paddingTop: 8, gap: 2 },
  /* Small, quiet, and on the picture rather than beside the title: it is true
     for an hour and it is about the photographs, not about the event. */
  liveTag: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 12.5, fontWeight: '600' },
  /* The card with nothing in it, which is mostly a button. Bordered, unlike
     the one that leads with a photograph: there is no picture to give it an
     edge, and a borderless block of text would not read as something to press. */
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  emptyLenses: { flexDirection: 'row', flex: 0 },
  emptyLens: { width: 30, height: 30, borderRadius: 15, marginRight: -8 },
  emptySlot: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySlotMark: { fontSize: 13, fontWeight: '700' },
  eventName: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  /* Wider apart than the cards on the other tabs: each group is three pieces
     stacked — a name, a strip of evenings and a line about the last one — and
     14 points between blocks made two groups read as one.

     `paddingTop` is this file's standing 72 rather than the design's 26: the
     mockup draws the status bar as a row of its own and measures from under
     it, and there is no safe-area library here — 72 is the one allowance every
     screen in this project already starts at. */
  groupsScroll: { padding: 20, paddingTop: 72, paddingBottom: 110, gap: 18 },
  groupsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  newGroup: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupBlock: { gap: 10 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  /* The door: small, because the evenings under it are what the block is for.
     It was 44 points when it was the only picture on the row. */
  groupTile: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  groupInitial: { fontSize: 13, fontWeight: '600' },
  groupName: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '600' },
  groupMeta: { fontSize: 12.5 },
  /* Three equal tiles with hairline gaps: one strip rather than three cards,
     which is what makes it read as "what is in here" and not as three things
     to choose between. */
  strip: { flexDirection: 'row', gap: 3 },
  stripTile: { flex: 1, height: 96 },
  stripShot: { width: '100%', height: '100%', borderRadius: 8 },
  stripEmpty: { borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
  stripMore: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,23,28,0.55)',
  },
  stripMoreText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  /* --- Find -------------------------------------------------------------
     One field, three chips, and rows under a hairline. Everything here
     replaced three bordered cards with a heading and a paragraph each. */
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  /* No padding of its own: the box has it, and a field with both is a caret
     that starts a quarter of an inch from the magnifier. */
  fieldText: { flex: 1, fontSize: 16, padding: 0 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  chipText: { fontSize: 13.5 },
  chipTextOn: { fontWeight: '600' },
  results: { },
  /* A hairline between rows rather than a border around each: three bordered
     boxes make three results look like three decisions. */
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  resultFace: { width: 38, height: 38, borderRadius: 10 },
  resultFaceBlank: { alignItems: 'center', justifyContent: 'center' },
  resultLetter: { fontSize: 14, fontWeight: '700' },
  resultName: { fontSize: 15.5, fontWeight: '600' },
  resultUnder: { fontSize: 13 },
  placeEvent: { paddingVertical: 6, paddingLeft: 50 },
  footnote: { fontSize: 13, lineHeight: 18, paddingTop: 4 },
});
