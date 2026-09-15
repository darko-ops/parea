/**
 * Three of the four tabs' contents: home, groups and find. You is its own file.
 *
 * ## One word for one thing, and the word is "album"
 *
 * It was "event", and the rule was that the product should say whatever the
 * schema says — because a second word costs a paragraph of explanation in every
 * file that touches it, and buys nothing.
 *
 * The rule holds; the word was wrong. "Event" is what the row is called and
 * what somebody making this thinks about. "Album" is what the row *is* to
 * everybody else: a set of photographs from one evening. Nobody outside this
 * repository has ever called it an event, and the interface was quietly asking
 * people to learn the database's vocabulary.
 *
 * So the split is deliberate and it is the only one: the schema, the routes and
 * the types say `event`, top to bottom, and every word a person reads says
 * album. Renaming the tables and the URLs to match would be a migration, a set
 * of dead links in everybody's messages, and no improvement to anything anybody
 * sees.
 *
 * All three read from `GET /api/events`, which lists what this actor can
 * actually reach: albums they have presented a credential to, plus every album
 * in a group they belong to. Not "everything a link would still open" — a link
 * is something you were sent, not somewhere you live, and an album opened once
 * a year ago does not belong on a home screen.
 */

import { ago, dateLabel, CARD_FACES, isLive } from '@parea/cards';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  ThreadLine,
} from './api';
import { ClusterCard } from './CreateGroup';
import { Glyph } from './Glyph';
import { ROUND, RoundButton } from './RoundButton';
import { StartSomething } from './StartSomething';
import { Wordmark } from './Wordmark';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { loadQueue, signOutDevice } from './platform';
import { Waiting } from './Waiting';

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
  onOpenPerson,
}: {
  event: EventListing;
  /** One clock for every card on screen, so none disagree about the minute. */
  now: Date;
  t: TabTheme;
  onPress: () => void;
  /**
   * The byline, which is a person and should behave like one.
   *
   * Null for somebody with no handle — a guest who arrived by link has a name
   * and a face here and no profile to open, so the row stays a label rather
   * than becoming a control that does nothing.
   */
  onOpenPerson: (handle: string) => void;
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
  /*
   * The circles are everybody the host shared it with, and no longer the host.
   *
   * They are named and pictured in the byline directly above, so the first
   * circle was the same person twice on one card — and on your own evenings it
   * was your own face, over a photograph you took, on a wall of your own
   * events.
   *
   * Filtered rather than sliced off the front. The server orders the host
   * first, so dropping `[0]` would look identical right up until an event
   * whose creator never turned up to it — at which point the card would
   * quietly stop showing a real guest.
   */
  const others = event.faces.filter((face) => !face.isCreator);
  const faces = others.slice(0, CARD_FACES);
  /*
   * Everybody no circle shows — and not the host either, who has the byline.
   *
   * `memberCount` counts the host when they are in their own event, which is
   * usually but not always. Rather than assume, subtract them only when the
   * face rows actually held one.
   */
  const hostCounted = event.faces.length > others.length ? 1 : 0;
  const moreFaces = Math.max(0, event.memberCount - hostCounted - faces.length);
  const date = dateLabel(event.eventDate ?? event.startsAt ?? event.firstPhotoAt);
  const host = event.mine ? 'You' : event.creator.name;

  /*
   * Whose evening this is, above the photograph rather than under it.
   *
   * The handle rather than the display name: it is the half of somebody that
   * is unique and the half they can be found by, and a wall of evenings is
   * exactly where two people called Ana need telling apart. The name still
   * appears in the line under the title — this row is the byline, that line is
   * the sentence.
   *
   * Written without the `@`. The sigil is what tells a handle from a name when
   * the two sit together in a sentence, and nothing here is a sentence: it is
   * a face and the word beside it, which is a byline, and a byline reads as a
   * name whether or not it is punctuated like one.
   *
   * Never a silhouette where there is no picture, which is the rule every
   * other face in this product follows: a letter on the person's own lens
   * colour, hashed from their handle so it is theirs and stays theirs.
   */
  const by = event.creator.handle ?? event.creator.name ?? 'Someone';
  const byLens = lensFor(event.creator.handle ?? event.creator.name ?? event.id);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {/*
        The byline goes to the person, not to the album.

        A face and a name at the top of a card is the one thing on this screen
        that is about somebody rather than about an evening, and it was the only
        such thing in the product that could not be pressed. Nested inside the
        card's own `Pressable`, which is what makes it work: the inner one takes
        the touch when it is on the byline and the outer one takes everything
        else, so the whole card still opens the album.

        Only when there is a handle to open. A guest who arrived by link has a
        name and a face and no profile, and a control that does nothing is worse
        than a label that never promised to.
      */}
      <Pressable
        onPress={
          event.creator.handle
            ? () => onOpenPerson(event.creator.handle!)
            : undefined
        }
        disabled={!event.creator.handle}
        accessibilityRole={event.creator.handle ? 'button' : 'text'}
        accessibilityLabel={event.creator.handle ? `${by}, see their profile` : by}
        style={styles.byline}
      >
        {event.creator.avatarUrl ? (
          <Image
            source={{ uri: event.creator.avatarUrl }}
            style={[styles.bylineFace, { backgroundColor: t.line }]}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View style={[styles.bylineFace, styles.bylineBlank, { backgroundColor: byLens.fill }]}>
            <Text style={[styles.bylineLetter, { color: byLens.ink }]}>
              {initialOf(event.creator.name ?? event.creator.handle)}
            </Text>
          </View>
        )}
        <Text style={[styles.bylineName, { color: t.fg }]} numberOfLines={1}>
          {by}
        </Text>
      </Pressable>

      <View style={styles.cover}>
        {event.cover && (
          <Image
            source={{ uri: event.cover.src }}
            style={styles.coverShot}
            contentFit="cover"
            transition={120}
          />
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
        {/*
          The name, then the evening, on one line.

          Whose evening it was is read first: the picture at the top is theirs,
          and both ends of the card being about the same person is what makes
          the middle of it an evening rather than a listing. The title follows
          on the same baseline, which is what turns two stacked facts into one
          sentence — "You, at Ana's birthday" rather than a label above a
          heading.

          Nested `Text` rather than a row of two.

          A `flexDirection: 'row'` would need `alignItems: 'baseline'` to stop
          a 13pt name floating against an 18pt title, and it would then have to
          be told which of the two may shrink. Inside one `Text` the baseline
          is the text engine's problem, and `numberOfLines={1}` truncates the
          line as a line — so a long title runs out of room rather than
          squeezing the name that introduces it.

          This line used to print both names — "both, always", on the reasoning
          that printing one makes the reader guess which they have. The byline
          above the photograph carries the handle now, so printing it again
          here says the same unique thing twice on one card and leaves the name
          looking like a label for it.

          What is left is the half the byline does not have: what somebody is
          called, which is what a reader recognises. On your own events that is
          "You" — your own name read back at you on a wall of your own evenings
          is the screen describing you to yourself.
        */}
        <Text numberOfLines={1}>
          {host && (
            <Text style={[styles.small, { color: t.dim }]}>{host}  </Text>
          )}
          <Text style={[styles.eventName, { color: t.fg }]}>{event.name}</Text>
        </Text>
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
 * A clock that ticks once a minute, for the "20 min ago" on each card.
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
  onCreateGroup,
  onOpenPerson,
  Button,
}: {
  api: Api;
  events: EventListing[];
  loading: boolean;
  t: TabTheme;
  onOpen: (event: EventListing) => void;
  onRefresh: () => Promise<void>;
  onCreate: () => void;
  /** A byline on a card is a person; pressing one opens them. */
  onOpenPerson: (handle: string) => void;
  /**
   * The group half of the `+`.
   *
   * Goes to the Groups tab with its form open, exactly as the profile's does —
   * the form there arrives with the people this person keeps ending up in
   * events with, and a bare name-and-nobody form is the empty-group problem
   * that tab was written to avoid.
   */
  onCreateGroup: () => void;
  Button: ButtonComponent;
}) {
  const [refreshing, setRefreshing] = useState(false);
  // One gesture refreshes both: pulling the list down and finding the count
  // above it stale would make the count the thing nobody trusts.
  const [pulled, setPulled] = useState(0);
  /** The `+`'s two choices. Nothing is made until one of them is picked. */
  const [starting, setStarting] = useState(false);
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
        A title and the one thing you can make from here.

        `Start one` was a word on the title's baseline and is a `+` now — the
        same 36pt bordered circle the Groups tab makes a group with and the
        album screen adds photographs with. Three tabs, one shape for "make
        something here", and it stops the heading row being two things to read
        on the way to the evenings underneath it.

        It opens the same two choices the profile's `+` does. One glyph meaning
        two things in one place and one thing in another is the sort of
        difference nobody can learn: either `+` makes what you ask it for.
      */}
      <View style={styles.markRow}>
        {/*
          Held open, so the name is centred on the screen rather than on what is
          left of it.

          The `+` is 36 points and the name sat between the edge and it, which
          put its middle 18 points left of the screen's — close enough to read
          as centred and not be, which is the version that looks like a mistake.
          A slot the size of the button on the other side is the only way to get
          it right without measuring anything.
        */}
        <View style={styles.roundSlot} />

        {/*
          The product's name, in the product's face.

          It said "Events", which is the software's word for what is underneath
          rather than the name of the thing somebody opened. The web has said
          `parea` in Garet on every page for as long as it has had a rail, and
          a client that names itself differently is two products.

          Lowercase in the style rather than typed that way, exactly as the web
          does it: the markup says the proper noun, so a screen reader says
          "Parea", and the type says how it is drawn.
        */}
        <View style={styles.centred}>
          <Wordmark color={t.fg} />
        </View>

        <RoundButton
          t={t}
          onPress={() => setStarting(true)}
          accessibilityLabel="New album or group"
        >
          <Glyph name="plus" size={20} color={t.fg} />
        </RoundButton>
      </View>

      {starting && (
        <StartSomething
          t={t}
          Button={Button}
          onClose={() => setStarting(false)}
          onAlbum={onCreate}
          onGroup={onCreateGroup}
        />
      )}

      {/*
        The invitations used to sit here, above the list, on the argument that
        they are the one thing on this screen somebody has to *do* something
        about. That was true while there was nowhere else for them.

        Lately is that somewhere else, and it holds the same four asks with the
        same two buttons — so keeping this meant the same request in two places
        at once, answered in one and still sitting in the other, which reads as
        the answer not having taken. `activity.ts` names that failure directly;
        it is the reason an answered friend request leaves the queue.

        What replaces it is the badge on the envelope, which is a smaller claim
        made in a place that is always there.
      */}

      {loading && filled.length === 0 && <Waiting fill />}

      {!loading && filled.length === 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          {/* No longer points at `Open a link`, which is not on this screen
              any more. An event somebody sends you opens itself when you tap
              it, so the only thing left for this card to offer is the one
              action that is here. */}
          <Text style={[styles.body, { color: t.fg }]}>
            Nothing here yet. Events you are sent open when you tap the link,
            and the ones you make show up here.
          </Text>
          <Button label="Create album" onPress={onCreate} t={t} primary />
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
          onOpenPerson={onOpenPerson}
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
/**
 * How many group blocks the tab opens with.
 *
 * Each is a name, a strip of covers and a line of conversation — about a
 * hundred points — so this is the number that fits under the heading without
 * pushing the one-off conversations off the screen entirely.
 */
const GROUPS_SHOWN = 3;

export function GroupsTab({
  api,
  events,
  t,
  openCreate = 0,
  active,
  onOpenGroup,
  onOpenGroupThread,
  onOpenEventThread,
  onGoToEvents,
  waiting,
  onOpenLately,
  onCreateAlbum,
  onCreateGroup,
  onCreateGroupFrom,
  Button,
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
  /**
   * How many things are waiting on an answer, for the badge on the envelope.
   *
   * Held above this screen and passed down, because the count is a fact about
   * the account rather than about this tab: it has to survive the tab being
   * unmounted, and it has to be re-read when something is answered on the
   * screen the envelope opens.
   */
  waiting: number;
  onOpenLately: () => void;
  /** The picker, for the half of `+` that makes an evening rather than a room. */
  onCreateAlbum: () => void;
  /** The page that makes a group. Opened with nobody chosen. */
  onCreateGroup: () => void;
  /** The same page, holding the people a cluster suggested. */
  onCreateGroupFrom: (cluster: Cluster) => void;
  /** The app's one button, for the sheet the `+` opens. */
  Button: ButtonComponent;
  /**
   * Whether this tab is the one in front.
   *
   * Kept-alive tabs do not refetch on their own, and this one has the most to
   * go stale: a group made from the profile's `+`, an event rolled into a
   * group, somebody else saying something in one. Returning re-reads quietly —
   * `load` never clears what it holds, so the rooms stay on screen while the
   * fresh answer is on its way.
   */
  active: boolean;
  onOpenGroup: (groupId: string) => void;
  /** A group's own conversation, which is not the same place as the group. */
  onOpenGroupThread: (group: MyGroupDetail) => void;
  /** An event's conversation — the album, opened on its Talk pane. */
  onOpenEventThread: (event: EventListing) => void;
  /** Where somebody with nothing to recognise yet is sent. */
  onGoToEvents: () => void;
}) {
  const [groups, setGroups] = useState<MyGroupDetail[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  /*
   * Which card is open as a form, or `'anyone'` for the one `New group` opens
   * with nobody in it. One at a time: two half-filled forms on one screen is
   * two things to cancel and a question about which Create belongs to which.
   */

  /**
   * Whether the list is showing all of them or the first few.
   *
   * Resets when the tab is left, which is deliberate: expanding is a thing you
   * do to find one room, not a preference about how this screen looks. Coming
   * back to a page scrolled past six group blocks is the state it was expanded
   * to get out of.
   */
  const [allGroups, setAllGroups] = useState(false);
  /** The `+` sheet, the same one Home and You open. */
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const [mine, found] = await Promise.all([
      api.myGroupsDetailed().catch(() => []),
      api.clusters().catch(() => ({ clusters: [], also: [] })),
    ]);
    setGroups(mine);
    setClusters(found.clusters);
  }, [api]);

  // On arrival, and on every return to the tab. Not on the switches away.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  /*
   * Collapsed again once the tab is left.
   *
   * The state above says this happens and, until this effect, it did not — the
   * tabs stay mounted, so nothing was ever unmounting it. Left as a comment
   * describing behaviour the code did not have, which is worse than no comment.
   *
   * `active` stays true while a screen is pushed over the tab, so opening a
   * group and coming back keeps the list as it was. It collapses only when
   * somebody genuinely goes elsewhere.
   */
  useEffect(() => {
    if (!active) setAllGroups(false);
  }, [active]);

  // Zero is the value nobody asked with — the tab opening normally, rather
  // than somebody arriving on it holding a press.
  useEffect(() => {
    if (openCreate > 0) onCreateGroup();
    // `onCreateGroup` is a route change and is stable; including it would fire
    // this on every render of the shell above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /*
   * Every album somebody has spoken in, newest conversation first.
   *
   * Sorted by when something was last *said*. A list of conversations ordered
   * by upload time puts a silent album full of photographs above the one
   * somebody is talking in, which is the wrong answer on a tab about talking.
   *
   * ## Only the ones somebody has actually spoken in
   *
   * These used to list whether or not anything had been said, on the argument
   * that an empty chat is a door and hiding it until somebody speaks means
   * nobody ever does. In practice it filled the section with rows reading
   * "Nobody has said anything yet" — a list of absences under a heading that
   * promises conversations. The door is still the album's own Talk tab.
   *
   * ## Including the ones inside a group
   *
   * This filtered grouped albums out, on the argument that their talk "belongs
   * under the group" and listing it twice would make the busiest rooms the
   * noisiest part of a screen meant to be scanned. The premise was wrong.
   *
   * A group's row shows *the group's own thread* — `ConversationLine` is fed
   * the group, not an album in it. So an album inside a group has a
   * conversation that appears nowhere on this tab: not on its group's row,
   * which is talking about something else, and not here. Four messages in an
   * evening and the only way back to them was to remember which album it was
   * and open its Talk tab.
   *
   * Nothing is listed twice, because the two lines were never the same line.
   */
  /**
   * The three most recently added to, unless somebody asked for the rest.
   *
   * `lastActiveAt` is null for a group nothing has happened in yet, and those
   * go last rather than first — an empty room is the least useful thing this
   * screen can lead with.
   */
  const shown = useMemo(() => {
    const ordered = [...(groups ?? [])].sort((a, b) =>
      (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''),
    );
    return allGroups ? ordered : ordered.slice(0, GROUPS_SHOWN);
  }, [allGroups, groups]);

  const loose = useMemo(
    () =>
      events
        .filter((event) => event.lastMessage != null)
        // By when something was last said. No fallback needed now that a row
        // without a message is not a row.
        .sort((a, b) => b.lastMessage!.at.localeCompare(a.lastMessage!.at)),
    [events],
  );

  /*
   * The whole screen, or none of it.
   *
   * The spinner used to sit under the heading, so the first paint was a title
   * and two discs with an empty space below them, and the page proper arrived a
   * round trip later. Two arrivals for one screen — and the heading is the part
   * that tells you where you are, so it landed first and then sat above nothing
   * while you waited.
   *
   * Only ever the first paint. `load` never puts `groups` back to null, so
   * coming back to the tab redraws the page it had and fills in behind it,
   * rather than blanking the screen on every switch.
   */
  if (groups === null) {
    return (
      <View style={styles.groupsLoading}>
        <Waiting size={40} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.groupsScroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.dim} />
      }
    >
      <View style={styles.groupsHead}>
        {/* "Your Parea" rather than "Groups": the tab holds the rooms and the
            conversations, and the word for all of that together is the one the
            product is named after. */}
        <Text style={[styles.h1, { color: t.fg }]}>Your Parea</Text>
        {/*
          A filled disc rather than an outlined word.

          Here in every state, including the empty one: somebody with no groups
          is who most needs to know one can be made. It is a glyph now because
          the screen's heading row is a heading and one action, and "New group"
          set beside a 30pt title was a second thing to read on the way to the
          rooms underneath it.
        */}
        <View style={styles.groupsActions}>
          {/*
            The door to Lately, beside the one that makes a room.
            
            Here rather than on a tab of its own: three tabs is the whole of
            this app's navigation, and a fourth carrying a list that is usually
            empty would cost a permanent quarter of the tab bar. A disc in a
            heading row costs nothing when there is nothing.

            The badge is hidden at zero, as the web's is. A badge that draws "0"
            teaches people that the number means nothing, and an empty circle is
            a claim that something is there.
          */}
          <RoundButton
            t={t}
            onPress={onOpenLately}
            accessibilityLabel={
              waiting > 0 ? `Lately, ${waiting} waiting on you` : 'Lately'
            }
          >
            <Glyph name="envelope" size={20} color={t.fg} />
            {waiting > 0 && (
              <View
                style={[
                  styles.envelopeBadge,
                  { backgroundColor: t.accent, borderColor: t.bg },
                ]}
              >
                <Text style={[styles.envelopeCount, { color: t.onAccent }]}>
                  {/* Past this the number stops being readable at 11.5pt and
                      stops being actionable anyway — "a lot" is the same
                      instruction as "99". */}
                  {waiting > 99 ? '99+' : waiting}
                </Text>
              </View>
            )}
          </RoundButton>

          {/*
            The `+`'s place is held even when the `+` is not there.

            It is hidden twice — while the groups are still arriving, and while
            the create form is open — and the envelope beside it is in a row
            that lays out from the right. So the envelope was drawn where the
            `+` belongs and then slid left the moment the groups landed, which
            on a cold open is the first thing on the screen and it moves.

            A control that is in a different place for the first half-second is
            a control somebody reaches for and misses.
          */}
          {/*
            The same `+` as Home and You, making the same two things.

            It made a group and only a group, because it is on the groups tab —
            which is the reasoning that produces an app where one glyph means
            two things in one place and one thing in another. Nobody can learn
            that: either `+` makes what you ask it for.
          */}
          {groups !== null ? (
            <RoundButton
              t={t}
              onPress={() => setStarting(true)}
              accessibilityLabel="New album or group"
            >
              <Glyph name="plus" size={20} color={t.fg} />
            </RoundButton>
          ) : (
            <View style={styles.roundSlot} />
          )}
        </View>
      </View>

      {starting && (
        <StartSomething
          t={t}
          Button={Button}
          onClose={() => setStarting(false)}
          onAlbum={onCreateAlbum}
          onGroup={onCreateGroup}
        />
      )}

      {/*
        The event chats are built from `events`, a prop the tabs already hold,
        so they would be on screen a round trip before the groups they sit
        beneath — the minor half of this tab arriving first and the rooms
        dropping in above it, pushing down whatever somebody had started
        reading. The early return above is what stops that: nothing at all
        until every part of this page can be drawn at once.
      */}
      {groups.length === 0 && clusters.length === 0 ? (
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
            accessibilityLabel="Go to your albums"
          >
            <Text style={[styles.headAction, { color: t.accent }]}>Your albums</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {shown.map((group) => (
            <GroupBlock
              key={group.id}
              group={group}
              albums={byGroup.get(group.id) ?? []}
              t={t}
              onPress={() => onOpenGroup(group.id)}
              onOpenThread={() => onOpenGroupThread(group)}
            />
          ))}

          {/*
            The rest, behind a word.

            A group block is a name, a strip of covers and a line of
            conversation — a hundred points of screen each — so somebody in
            eight groups scrolled past six of them to reach the one-off
            conversations underneath, every time. Three is what fits above the
            fold beside the heading, and three is also about how many rooms
            anybody is actually in this week.

            Ordered by `lastActiveAt`, so the three are the ones most recently
            added to rather than the three oldest, which is what an unsorted
            list from the server happened to give.

            Expanded in place rather than on a screen of its own: the full list
            is this same list, and pushing a second copy of it would mean two
            places where a group block is drawn.
          */}
          {groups.length > shown.length && (
            <Pressable
              onPress={() => setAllGroups(true)}
              accessibilityRole="button"
              accessibilityLabel={`All groups, ${groups.length}`}
              style={({ pressed }) => [styles.allGroups, { borderColor: t.line, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.allGroupsText, { color: t.fg }]}>
                All groups
              </Text>
              <Text style={[styles.allGroupsCount, { color: t.dim }]}>{groups.length}</Text>
            </Pressable>
          )}
        </>
      )}

      {/*
        The conversations that belong to no group.

        An evening with the same six people every month becomes a group and its
        talk moves under that group's block. An evening that never will — a
        wedding, somebody's leaving do, the one barbecue — still has a thread,
        and before this it was reachable only by remembering which album it was
        inside. This is the other half of "one tab for every conversation".

        Grouped albums are here too. They were held back on the grounds that
        their talk belongs under the group — but a group's row carries the
        group's own thread, so an album's conversation had nowhere at all to
        appear. See `loose` above.
      */}
      {loose.length > 0 && (
        <View style={{ gap: 2 }}>
          <Text style={[styles.sectionLabel, { color: t.dim }]}>GROUP CHATS</Text>
          {loose.map((event, i) => (
            <Pressable
              key={event.id}
              onPress={() => onOpenEventThread(event)}
              accessibilityRole="button"
              accessibilityLabel={`${event.name}, conversation`}
              style={({ pressed }) => [
                styles.chatRow,
                // No rule under the last one: a divider at the foot of a list
                // is a line under nothing.
                i < loose.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line },
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              {event.cover ? (
                <Image
                  source={{ uri: event.cover.src }}
                  style={[styles.chatThumb, { backgroundColor: t.line }]}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View
                  style={[styles.chatThumb, { backgroundColor: lensFor(event.id).fill }]}
                />
              )}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[styles.chatName, { color: t.fg }]} numberOfLines={1}>
                  {event.name}
                </Text>
                <ConversationLine line={event} t={t} dot />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/*
        What the product noticed, as one line at the foot of everything it
        already knows about.

        Below the conversations rather than between them. It is the one thing
        on this tab that is a suggestion rather than a room somebody is
        already in, and sitting it between the groups and the event chats put
        an offer in the middle of a list of places — which read as a break in
        the list rather than as a remark about it.

        Never more than two, and a cluster whose people are already gathered
        in one of these groups is dropped by the server — which is what lets
        this stay without needing a way to dismiss it.
      */}
      {/*
        A cluster opens the same page the `+` does, holding its people and its
        suggested name. It used to unfold a form in its place, which meant two
        ways to make a group with two layouts and two sets of copy — and the
        one reachable from a suggestion was the one that could not search.
      */}
      {clusters.map((cluster) => (
        <ClusterCard
          key={cluster.key}
          cluster={cluster}
          onMake={() => onCreateGroupFrom(cluster)}
          t={t}
        />
      ))}

      {/*
        Where the other kind of group is. Discovery lives on Find and stays
        there — this tab is the rooms you are in, and a second list of rooms
        you are not would make it two screens wearing one title.
      */}
      {groups.length > 0 && (
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
  onOpenThread,
}: {
  group: MyGroupDetail;
  /** This actor's own albums in this group, newest first. Never the group's. */
  albums: EventListing[];
  t: TabTheme;
  /** The block itself: the room, its people and its evenings. */
  onPress: () => void;
  /** The line at the foot: the conversation, which is a different place. */
  onOpenThread: () => void;
}) {
  const lens = lensFor(group.id);
  /*
   * The covers this person can actually draw.
   *
   * An evening they are not in has no listing here and so no cover — and an
   * album nobody has photographed yet has none either. Both used to leave a
   * dashed box; neither leaves anything now.
   */
  const withCovers = albums.filter((album) => album.cover).slice(0, COVER_STRIP);
  /*
   * How many evenings are not in the strip.
   *
   * Counted off the group's own `eventCount` rather than off `albums`, because
   * that is the honest number: it is what the room holds, and it is already
   * disclosed to every member — `groupEvents` lists all of them by name. The
   * strip shows the ones this person can open.
   */
  const more = Math.max(0, group.eventCount - withCovers.length);

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

      {/*
        Only the covers that exist, and no strip at all without one.

        It used to draw three slots whatever the group held, filling the gaps
        with dashed outlines — so a room with one evening in it was a
        photograph and two empty boxes, and a room with none was three empty
        boxes and 84 points of nothing. A placeholder is worth drawing where
        somebody is meant to put something; nobody puts an album into a strip.
        Here it was the product reserving room for absences.

        The tiles keep `flex: 1`, so one cover fills the width and two split it
        — the strip is as wide as the block either way and the pictures grow to
        meet it, rather than a lone cover sitting in a third of the space with
        the rest blank.
      */}
      {withCovers.length > 0 && (
        <View style={styles.strip}>
          {withCovers.map((album, i) => (
            <View key={album.id} style={styles.stripTile}>
              <Image
                source={{ uri: album.cover!.src }}
                style={[styles.stripShot, { backgroundColor: t.line }]}
                contentFit="cover"
                transition={120}
              />
              {i === withCovers.length - 1 && more > 0 && (
                <View style={styles.stripMore}>
                  <Text style={styles.stripMoreText}>+{more}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/*
        The last thing said in it, which is what makes this a conversation
        rather than a folder.

        It replaced "Added to 2 days ago · Ana's birthday" — a line about the
        newest *event*, which the strip of covers directly above it already
        shows. Two statements of the same fact, and neither of them the one
        thing that would make somebody open the room today.

        Unread is carried by ink as well as by the pill: a waiting message is
        set in `fg`, a read one in `dim`. The pill alone is a small blue circle
        somebody has to find; the weight of the line is what they see first.
      */}
      <ConversationLine
        line={group}
        fallback={
          group.eventCount === 0
            ? 'Nothing in it yet — anyone in it can start the first album.'
            : 'Nobody has said anything yet.'
        }
        t={t}
        onPress={onOpenThread}
      />
    </Pressable>
  );
}

/**
 * One conversation, as one line: who spoke, what they said, when, and how many
 * are waiting.
 *
 * Shared by the group blocks and the event-chat rows because they are the same
 * sentence about two kinds of room, and written twice they would drift the
 * first time somebody changed how a name is emphasised.
 *
 * The count is a pill on a group and a dot on an event chat, which is not
 * decoration: a group is busy and the number is the useful part, where an
 * event chat is usually one or two messages and a number on it is precision
 * nobody asked for.
 */
function ConversationLine({
  line,
  fallback,
  t,
  dot = false,
  onPress,
}: {
  line: ThreadLine;
  /**
   * What a thread nobody has spoken in says.
   *
   * Optional, because the event chats no longer list a conversation that has
   * not happened — only a group block can be empty and still be worth drawing,
   * since the room exists whether or not anybody has spoken in it yet.
   */
  fallback?: string;
  t: TabTheme;
  /** A dot rather than a count. See above. */
  dot?: boolean;
  onPress?: () => void;
}) {
  const unread = line.unreadCount > 0;
  const last = line.lastMessage;

  const body = (
    <>
      {last ? (
        <>
          <View style={[styles.sayerFace, { backgroundColor: lensFor(last.author).fill }]}>
            <Text style={[styles.sayerInitial, { color: lensFor(last.author).ink }]}>
              {initialOf(last.author)}
            </Text>
          </View>
          <Text
            style={[styles.said, { color: unread ? t.fg : t.dim }]}
            numberOfLines={1}
          >
            {/* "You" rather than your own name read back at you — the same
                thing every card in this product does. */}
            <Text style={styles.sayer}>{last.mine ? 'You' : last.author}</Text>{' '}
            {last.body}
          </Text>
          <Text style={[styles.saidWhen, { color: t.dim }]}>
            {ago(new Date(last.at), new Date())}
          </Text>
        </>
      ) : fallback ? (
        <Text style={[styles.said, { color: t.dim }]} numberOfLines={1}>
          {fallback}
        </Text>
      ) : null}

      {unread &&
        (dot ? (
          <View style={[styles.unreadDot, { backgroundColor: t.accent }]} />
        ) : (
          <View style={[styles.unreadPill, { backgroundColor: t.accent }]}>
            <Text style={[styles.unreadCount, { color: t.onAccent }]}>
              {line.unreadCount > 99 ? '99+' : line.unreadCount}
            </Text>
          </View>
        ))}
    </>
  );

  if (!onPress) return <View style={styles.sayRow}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        last
          ? `Conversation, ${line.unreadCount > 0 ? `${line.unreadCount} new, ` : ''}${
              last.mine ? 'you' : last.author
            } said ${last.body}`
          : 'Conversation, nothing said yet'
      }
      style={({ pressed }) => [styles.sayRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
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
            ? 'None of your albums say where they were yet. Whoever starts one can add a place, and it shows up here.'
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
      'Your email address and this account are removed. The photos you added stay in their albums and stay yours to remove.',
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
          ? 'No password — a code goes to your inbox, and your albums follow you to another device.'
          : 'Optional. Add an email and your albums and groups follow you to another device. No password — a code goes to your inbox.'}
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
  /* `flexGrow` so a page that is still loading fills the screen and the
     spinner has somewhere to be the middle of. Inert once there are cards. */
  scroll: { padding: 20, paddingTop: 72, paddingBottom: 110, gap: 14, flexGrow: 1 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  /*
   * The wordmark's row, which is not `headRow`.
   *
   * `alignItems: 'baseline'` is right for a title beside a button and wrong for
   * this: the name is set in a face with its own metrics, so aligning the disc
   * to its baseline hangs the button low. Centred on the row instead, which is
   * what the eye reads as level.
   */
  markRow: { flexDirection: 'row', alignItems: 'center' },
  /* Takes the space the two discs leave, so the middle of the name is the
     middle of the screen. The word centres itself inside it — see
     `Wordmark.tsx`, which has no intrinsic width to centre by. */
  centred: { flex: 1 },
  /* Two of them now, so they need a row of their own rather than each being a
     child of the space-between. Wide enough apart to be two targets. */
  headActions: { flexDirection: 'row', alignItems: 'baseline', gap: 18 },
  headAction: { fontSize: 14, fontWeight: '600' },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  /* The photograph is the card: no border, no panel, no strip of chrome. What
     used to be `event` was a bordered box around a mosaic and a detail strip;
     what is left is a tall picture, some faces over its edge, and two lines. */
  /*
   * Edge to edge, and square.
   *
   * The scroll keeps its 20pt gutter for everything that is words; the
   * photograph steps back out of it. A rounded card inset from both sides is a
   * *card* — an object on a page, with the page showing around it — and the
   * subject of this screen is the photograph, not the container it arrived in.
   * At full width with square corners the picture is the card, which is what
   * the note at the top of `EventCard` claims and the 18pt radius was quietly
   * contradicting.
   *
   * The negative margin rather than a padding-free scroll: the alternative is
   * moving the gutter onto every text block separately, which is four places
   * to keep in step instead of one.
   */
  cover: { marginHorizontal: -20, overflow: 'hidden', height: 260, backgroundColor: '#8881' },
  coverShot: { width: '100%', height: '100%' },
  /* Over the picture's bottom edge, not under it — see the note on the card.
     The negative margin is the overlap, and the row sits above the text it
     shares a column with.

     Aligned to that text rather than inset from the picture. While the cover
     was a rounded card, 14 from its left corner was the obvious reference;
     now that the photograph runs to the screen edge the only column left to
     line up with is the title underneath. */
  faces: { flexDirection: 'row', marginTop: -13, marginLeft: -4, marginBottom: 2 },
  /* 70% of the 34 these were. Every number in the stack is scaled with the
     circle rather than only its width — the ring, the overlap and the letter
     were all chosen against 34, and leaving any of them put would make a
     smaller face look heavier rather than smaller. The overlap onto the
     photograph above (`faces.marginTop`) scales for the same reason. */
  face: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    marginRight: -6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceShot: { width: '100%', height: '100%' },
  faceLetter: { fontSize: 8.5, fontWeight: '700' },
  faceMore: { paddingHorizontal: 2 },
  under: { marginHorizontal: -4, paddingTop: 8, gap: 2 },
  /* The byline, above the photograph. Aligned to the same column as the title
     below it — `under`'s 4, so the face, the name and the date share an edge. */
  /*
   * The card's text column, and it answers to the screen rather than to the
   * scroll.
   *
   * Everything here used to sit at the scroll's 20 plus 4 of its own — 24 from
   * the glass, which was the right distance while the photograph was an inset
   * card and its corner was the thing being lined up with. The photograph runs
   * to the edge now, so the only edge left to measure from is the screen's,
   * and 24 read as a wide margin beside a picture with none at all.
   *
   * `-4` against the scroll's 20 puts the whole column at 16. One number, in
   * three places that must agree: the byline, the faces and the title block.
   */
  byline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: -4,
    paddingBottom: 8,
  },
  bylineFace: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  bylineBlank: { alignItems: 'center', justifyContent: 'center' },
  bylineLetter: { fontSize: 12, fontWeight: '700' },
  bylineName: { flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: '700' },
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
  /* 18 rather than 22. It is no longer the first thing on the card — the
     byline and the creator's name are both above it — and at 22 it went on
     competing with the photograph for the loudest thing in the column. */
  eventName: { fontSize: 18, fontWeight: '700' },
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
  groupsScroll: { padding: 20, paddingTop: 72, paddingBottom: 110, gap: 18, flexGrow: 1 },
  groupsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
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
  stripTile: { flex: 1, height: 84 },
  stripShot: { width: '100%', height: '100%', borderRadius: 8 },
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
  /* One conversation, as one line. Shared by a group block and an event chat. */
  sayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sayerFace: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sayerInitial: { fontSize: 11, fontWeight: '700' },
  said: { flex: 1, minWidth: 0, fontSize: 13.5 },
  /* The name carries the weight; the message is the same size beside it. */
  sayer: { fontWeight: '600' },
  saidWhen: { fontSize: 12.5 },
  /* A number on a group — it is busy and the number is the useful part. */
  groupsActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  /* Exactly a `RoundButton`, drawing nothing. Sized from the same constant so
     the two cannot drift apart. */
  roundSlot: { width: ROUND, height: ROUND },

  /* The first paint, before there is a page to draw. Centred in the tab rather
     than under a heading, because there is no heading yet. */
  groupsLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /* A row rather than a link: it is the foot of a list and it is the width of
     one, so a word floating on the left would read as a caption on the group
     above it. */
  allGroups: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  allGroupsText: { fontSize: 15, fontWeight: '600' },
  allGroupsCount: { fontSize: 13.5 },
  /* The mobile unread pill, moved onto the corner of a disc: same 19pt, same
     accent fill, same ink. The ring is the page behind it, so the badge reads
     as sitting on top of the button rather than inside it. */
  envelopeBadge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 5,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  envelopeCount: { fontSize: 11.5, fontWeight: '700' },
  unreadPill: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: { fontSize: 11.5, fontWeight: '700' },
  /* A dot on an event chat — usually one or two messages, and a count there is
     precision nobody asked for. */
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  /* The one-off evenings, under a label rather than a heading: they are the
     minor half of this screen and a 30pt title would say otherwise. */
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7, paddingBottom: 4 },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
  chatThumb: { width: 40, height: 40, borderRadius: 10 },
  chatName: { fontSize: 15, fontWeight: '600' },
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
