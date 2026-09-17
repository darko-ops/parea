/**
 * Groups — design §3, and the half of §1's native case that is not
 * auto-selection.
 *
 * A group is the answer to "the same people keep doing things together": one
 * place the events accumulate, so nobody re-solves *how do I reach everyone*
 * for the fourth dinner running. On the web it is reachable only from an event
 * you still have the link to, which makes it an attribute of a link rather
 * than of a person. Here it belongs to the actor, so a reinstall does not lose
 * it and a lost link is recoverable.
 *
 * The distinction the whole screen turns on is **door versus room**. A member
 * sees the events. Everyone else sees a name and a member count, and only if
 * the group chose to be findable — there is no state in which a stranger
 * learns what events exist, let alone what is in them. The server enforces
 * that; this file must not present anything that implies otherwise.
 */

import { dateLabel } from '@parea/cards';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import type { Api, GroupAlbum, GroupPerson, GroupRoom, GroupView, JoinRequest } from './api';
import { Glyph } from './Glyph';
import { initialOf, lensFor } from './lens';
import { More, RoundButton } from './RoundButton';
import { Waiting } from './Waiting';

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Structural rather than imported, to keep this file out of App's import cycle. */
export type GroupTheme = {
  bg: string;
  fg: string;
  dim: string;
  card: string;
  line: string;
  accent: string;
  onAccent: string;
  /** The one red, for the two actions that take something away. */
  warn: string;
  /** `bg` at zero alpha, for fading to the page without passing through grey. */
  bgClear: string;
};

export type OpenableEvent = {
  id: string;
  name: string;
  linkToken: string;
  startsAt: string | null;
  endsAt: string | null;
};

export function GroupScreen({
  api,
  groupId,
  t,
  onBack,
  onOpenEvent,
  onCreateEvent,
  onOpenThread,
  onOpenPerson,
  Button,
}: {
  api: Api;
  groupId: string;
  t: GroupTheme;
  onBack: () => void;
  onOpenEvent: (event: OpenableEvent) => void;
  onCreateEvent: (groupName: string) => void;
  /**
   * Into the group's own conversation.
   *
   * Handed the room rather than an id, so the bar on the other side can be
   * drawn from what this screen already has: re-fetching a group to render its
   * name is a spinner where a name should be.
   */
  onOpenThread: (group: GroupRoom) => void;
  /** Somebody in the room, by handle. Never called for a face without one. */
  onOpenPerson: (handle: string) => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [group, setGroup] = useState<GroupView | null>(null);
  /** The two sheets: everybody in the room, and everything else about it. */
  const [everyone, setEveryone] = useState(false);
  const [more, setMore] = useState(false);

  /**
   * Opening one, with what the album screen needs to present a credential.
   *
   * The token and the evening's window travel with it: without them an album
   * reached through a group falls through to the system picker for every
   * upload, and the reason it would is invisible. See `GroupEvent` on the
   * server.
   */
  const openAlbum = useCallback(
    (album: GroupAlbum) =>
      onOpenEvent({
        id: album.id,
        name: album.name,
        linkToken: album.linkToken,
        startsAt: album.startsAt,
        endsAt: album.endsAt,
      }),
    [onOpenEvent],
  );
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await api.group(groupId);
      setGroup(view);
      setError(null);
      // Only an admin may read these, and asking as anyone else is a 404 —
      // so it is asked for separately rather than folded into the group.
      if (view.member && view.role === 'admin') {
        setRequests(await api.joinRequests(groupId).catch(() => []));
      }
    } catch {
      // One message for "no such group", "private group" and "not for you".
      // Telling them apart would make this screen a way to confirm a private
      // group exists, which is the one thing the server refuses to do.
      setError('That group is not available.');
    }
  }, [api, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.joinGroup(groupId);
      if (result.requested) {
        Alert.alert(
          'Asked to join',
          'An admin will see your request. Nothing happens until they say yes.',
        );
      }
      await load();
    } catch {
      Alert.alert('Could not join', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, groupId, load]);

  const leave = useCallback(() => {
    Alert.alert('Leave this group?', 'You keep any album links you already have.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await api.leaveGroup(groupId).catch(() => {});
          onBack();
        },
      },
    ]);
  }, [api, groupId, onBack]);

  const resolve = useCallback(
    async (requestId: string, action: 'approve' | 'decline') => {
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      await api.resolveRequest(groupId, requestId, action).catch(() => {});
      await load();
    },
    [api, groupId, load],
  );

  /*
   * Both of these sit above the `error` and `!group` returns below, and have
   * to stay there.
   *
   * They were under them, which is how this screen crashed on open: the first
   * render has no group yet and returns the spinner early, so it runs fewer
   * hooks than the render after the group arrives. React counts hooks by
   * position and refuses the second render outright — "rendered more hooks
   * than during the previous render" — so the screen did not draw at all.
   *
   * The memo therefore has to survive a null group, which is what the `?.`
   * below is for: no group means no shelf, not a throw.
   */
  const { width } = useWindowDimensions();

  /**
   * The archive, split the way somebody reads it rather than the way it is
   * stored.
   *
   * The newest album is its own thing — a full-width cover with its name on it,
   * because on a screen about a room that keeps meeting, *what happened last*
   * is the question the room is opened with. Everything behind it is a shelf:
   * a thumbnail and two lines, which is as much as an album from March needs
   * to be found by.
   *
   * Months carry this year. Older years get a divider of their own and a flat
   * list underneath, because twelve month headings for a year nobody is
   * scrolling to is a year that takes twelve screens to pass.
   */
  const shelf = useMemo(() => {
    const events = group?.member ? group.events : [];
    const [newest, ...rest] = events;
    const thisYear = new Date().getUTCFullYear();

    const months: { key: string; label: string; events: GroupAlbum[] }[] = [];
    const years = new Map<number, GroupAlbum[]>();
    for (const album of rest) {
      const at = new Date(album.at);
      const year = Number.isNaN(at.getTime()) ? thisYear : at.getUTCFullYear();
      if (year !== thisYear) {
        years.set(year, [...(years.get(year) ?? []), album]);
        continue;
      }
      const label = monthName(at);
      const last = months[months.length - 1];
      // Contiguous runs, not a map: the list arrives newest-first so a month's
      // albums are already together, and a map would quietly reorder them if
      // that ever stopped being true. This draws a heading twice instead,
      // which is visibly wrong rather than silently rearranged.
      if (last && last.label === label) last.events.push(album);
      else months.push({ key: `${year}-${label}`, label, events: [album] });
    }
    return { newest, months, years: [...years.entries()].sort((a, b) => b[0] - a[0]) };
  }, [group]);

  if (error) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={onBack}>
          <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.body, { color: t.dim }]}>{error}</Text>
      </ScrollView>
    );
  }

  if (!group) {
    return (
      <View style={styles.center}>
        <Waiting size={40} />
      </View>
    );
  }

  const lens = lensFor(group.id);


  return (
    <>
    <ScrollView contentContainerStyle={styles.scroll}>
      {/*
        Back on the left, and on the right the two things this room can do that
        are not looking at it: say something, and everything else.

        All three are the same 36pt bordered disc. The back arrow was a bare
        `‹` in accent text, which made the one control every screen has the one
        control that looked like nothing else in the product.
      */}
      <View style={styles.headRow}>
        <RoundButton t={t} onPress={onBack} accessibilityLabel="Back">
          <Text style={[styles.back, { color: t.fg }]}>‹</Text>
        </RoundButton>

        {group.member && (
          <View style={styles.headActions}>
            <RoundButton
              t={t}
              onPress={() => onOpenThread(group)}
              accessibilityLabel={`Talk in ${group.name}`}
            >
              <Glyph name="plane" size={17} color={t.fg} />
            </RoundButton>
            {/*
              Everything else about the room, behind the same `⋯` an album's
              own settings sit behind. Leaving used to be a red button at the
              foot of the archive, which put the one irreversible thing on this
              screen at the end of the one list somebody scrolls to the bottom
              of.
            */}
            <RoundButton t={t} onPress={() => setMore(true)} accessibilityLabel="Group settings">
              <More color={t.fg} />
            </RoundButton>
          </View>
        )}
      </View>

      {/*
        The room's own face: its letter on its lens, never a photograph
        borrowed from inside. A picture from one evening standing for the room
        says that evening is the room.
      */}
      <View style={styles.identity}>
        <View style={[styles.crest, { backgroundColor: lens.fill }]}>
          <Text style={[styles.crestLetter, { color: lens.ink }]}>{initialOf(group.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.h1, { color: t.fg }]} numberOfLines={2}>
            {group.name}
          </Text>
          {/*
            How much is in here, and how long it has been going.

            Set in the monospaced line the rest of the product measures things
            with — the rule over an album on the home list is the same face for
            the same reason: these are facts about a box rather than something
            somebody wrote.

            A member count used to be half of this and is not, because the row
            of faces directly below says it better. What a count cannot say is
            *since March 2024*, and a group's age is most of what makes it read
            as a room rather than as a list.
          */}
          {group.member && (
            <Text style={[styles.measured, { color: t.dim }]} numberOfLines={1}>
              {`${plural(group.events.length, 'album')} · since ${sinceOf(group.createdAt)}`}
            </Text>
          )}
        </View>
      </View>

      {!group.member ? (
        // The door. Deliberately spare: a name and a count is everything a
        // non-member is told, and the button says which of the two things is
        // about to happen rather than making them find out.
        <View style={[styles.card, styles.gutter, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.body, { color: t.fg }]}>
            {group.canJoinDirectly
              ? 'You were at one of this group\u2019s albums, so you can join without asking.'
              : 'Ask to join, and an admin will decide. Nothing here is visible until then.'}
          </Text>
          <Button
            label={busy ? 'Sending…' : group.canJoinDirectly ? 'Join' : 'Ask to join'}
            onPress={join}
            disabled={busy}
            t={t}
            primary
          />
        </View>
      ) : (
        <>
          {/*
            Who is in the room, as a stack rather than a row.

            It was a horizontal scroll of faces with first names under them,
            which is a directory: to read it you scroll it, and it takes the
            full width to say what a stack says in a third of it. Overlapped,
            the faces are one object — a group of people rather than a list of
            them — and the width it gives back is what carries the sentence
            beside it.

            Rounded squares, like every other face in this product. The
            overlapping circles over an album's cover are the exception and
            stay one: that row reads as a crowd because circles overlap
            cleanly, and it has no words next to it to line up with.
          */}
          <Pressable
            onPress={() => setEveryone(true)}
            accessibilityRole="button"
            accessibilityLabel={`Everyone in ${group.name}`}
            style={({ pressed }) => [styles.peopleRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={styles.stack}>
              {group.people.slice(0, FACES).map((person, i) => {
                const own = lensFor(person.actorId);
                return person.avatarUrl ? (
                  <Image
                    key={person.actorId}
                    source={{ uri: person.avatarUrl }}
                    style={[styles.stackFace, i > 0 && styles.stacked, { borderColor: t.bg, backgroundColor: t.line }]}
                    contentFit="cover"
                    transition={120}
                  />
                ) : (
                  <View
                    key={person.actorId}
                    style={[
                      styles.stackFace,
                      styles.centred,
                      i > 0 && styles.stacked,
                      { borderColor: t.bg, backgroundColor: own.fill },
                    ]}
                  >
                    <Text style={[styles.stackLetter, { color: own.ink }]}>
                      {initialOf(person.name)}
                    </Text>
                  </View>
                );
              })}
              {group.memberCount > FACES && (
                <View
                  style={[
                    styles.stackFace,
                    styles.centred,
                    styles.stacked,
                    { borderColor: t.bg, backgroundColor: t.card },
                  ]}
                >
                  <Text style={[styles.stackMore, { color: t.dim }]}>
                    +{group.memberCount - FACES}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              {/*
                The one fact about a room that a count of heads does not give.

                "Six of you have been to every one" says whether this is a
                group where everybody turns up or a group with a core and a
                fringe, which is the thing somebody opening it actually wants
                to know. It falls back to the count where there is no archive
                to have attended — see `attendedEvery` on the server, which
                answers null rather than telling somebody that eleven of them
                have been to all nought of the albums.
              */}
              <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
                {group.everyAlbum !== null && group.everyAlbum > 1
                  ? `${group.everyAlbum} of you have been to every one`
                  : plural(group.memberCount, 'person', 'people')}
              </Text>
              <Text style={[styles.small, styles.everyone, { color: t.accent }]}>Everyone ›</Text>
            </View>
          </Pressable>

          {group.role === 'admin' && requests.length > 0 && (
            <View style={[styles.card, styles.gutter, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={[styles.label, { color: t.fg }]}>
                {requests.length} waiting to join
              </Text>
              {requests.map((request) => (
                <View key={request.id} style={styles.requestRow}>
                  {/* No profiles to link to; a name if they gave one. */}
                  <Text style={[styles.body, { color: t.fg, flex: 1 }]}>
                    {request.displayName ?? 'Someone'}
                  </Text>
                  <Pressable onPress={() => resolve(request.id, 'approve')} hitSlop={8}>
                    <Text style={[styles.body, { color: t.accent }]}>Approve</Text>
                  </Pressable>
                  <Pressable onPress={() => resolve(request.id, 'decline')} hitSlop={8}>
                    <Text style={[styles.body, { color: t.dim }]}>Decline</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {group.events.length === 0 ? (
            <View style={[styles.card, styles.gutter, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={[styles.body, { color: t.dim }]}>
                Nothing yet. The next album anybody makes in this group shows up
                here, and everyone gets told.
              </Text>
            </View>
          ) : (
            <>
              {/*
                What happened last, at the size it deserves.

                Every album used to be a full-width cover, which is a feed:
                thirty-four of them is thirty-four screens, and an archive is a
                thing you look *back* through. One card and then a shelf says
                which of those two jobs each row is doing.
              */}
              {shelf.newest && (
                <View style={styles.section}>
                  <Rule t={t} label={`Newest · ${dateLabel(shelf.newest.at) ?? ''}`} />
                  <Feature
                    album={shelf.newest}
                    t={t}
                    width={width}
                    onPress={() => openAlbum(shelf.newest!)}
                  />
                </View>
              )}

              {shelf.months.map((month) => (
                <View key={month.key} style={styles.section}>
                  <Rule t={t} label={month.label} count={String(month.events.length)} />
                  {month.events.map((album) => (
                    <Row
                      key={album.id}
                      album={album}
                      t={t}
                      onPress={() => openAlbum(album)}
                    />
                  ))}
                </View>
              ))}

              {/*
                A year, once, rather than its twelve months.

                Twelve headings for a year nobody is scrolling to is a year
                that takes twelve screens to pass. The rows under a year carry
                the month in their own date line instead, which is the only
                thing the headings were telling anybody.
              */}
              {shelf.years.map(([year, albums]) => (
                <View key={year} style={styles.section}>
                  <Rule
                    t={t}
                    label={String(year)}
                    count={plural(albums.length, 'album')}
                    loud
                  />
                  {albums.map((album) => (
                    <Row
                      key={album.id}
                      album={album}
                      t={t}
                      withMonth
                      onPress={() => openAlbum(album)}
                    />
                  ))}
                </View>
              ))}
            </>
          )}

          {/*
            What a group is, said once, at the bottom.

            Leaving is behind the `⋯` now and an alert asks before it happens,
            but an alert is read by somebody who has already decided. This is
            the sentence for somebody deciding — and it is at the foot because
            that is where you arrive having scrolled the archive, which is
            exactly when "what happens to all this if I go" occurs to you.
          */}
          <Text style={[styles.footnote, styles.gutter, { color: t.dim, borderTopColor: t.line }]}>
            Photos live in the albums, not in the group. Leaving stops the next
            one reaching you — it takes nothing away from the albums you were in.
          </Text>
        </>
      )}
    </ScrollView>

    {/*
      Making one, floating clear of the archive.

      It was a button at the foot of the list, which is the one place somebody
      who wants to make an album is not: they opened the room to add to it, and
      scrolling thirty-four albums to reach the control for that is the list
      charging admission. Above where the tab bubble sits, on the same side as
      the thumb that would press it.
    */}
    {group.member && (
      <Pressable
        onPress={() => onCreateEvent(group.name)}
        accessibilityRole="button"
        accessibilityLabel="New album in this group"
        style={({ pressed }) => [
          styles.make,
          { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Glyph name="plus" size={18} color={t.onAccent} />
        <Text style={[styles.makeLabel, { color: t.onAccent }]}>New album</Text>
      </Pressable>
    )}

    {everyone && group.member && (
      <Everyone
        t={t}
        people={group.people}
        name={group.name}
        onOpenPerson={onOpenPerson}
        onClose={() => setEveryone(false)}
      />
    )}

    {more && group.member && (
      <GroupMore t={t} Button={Button} onLeave={leave} onClose={() => setMore(false)} />
    )}
    </>
  );
}

/** How many faces the stack shows before it starts counting. */
const FACES = 5;

/** "Mar 2024", for the line under a group's name. */
function sinceOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'the start';
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

/** The month a group's run of albums is filed under. */
function monthName(at: Date): string {
  if (Number.isNaN(at.getTime())) return 'Undated';
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(at);
}

/**
 * A heading with a hairline running off to the edge.
 *
 * The same line the home list rules a card with, and deliberately: both are a
 * label on the outside of a box, and a second treatment for one idea is how a
 * product comes to have two. `loud` is the year, which is a bigger division
 * than a month and says so with ink rather than with size.
 */
function Rule({
  label,
  count,
  t,
  loud = false,
}: {
  label: string;
  count?: string;
  t: GroupTheme;
  loud?: boolean;
}) {
  return (
    <View style={[styles.rule, styles.gutter]}>
      <Text style={[styles.measured, { color: loud ? t.fg : t.dim }]}>{label}</Text>
      <View style={[styles.hair, { backgroundColor: t.line }]} />
      {count && <Text style={[styles.measured, styles.ruleCount, { color: t.dim }]}>{count}</Text>}
    </View>
  );
}

/**
 * The newest album, at the size of the thing it is.
 *
 * Full-bleed against the scroll's gutter and at the cover's own 4:5, with the
 * name over the foot of the picture. This is the one row on the screen where
 * the photograph is the point rather than a way of recognising a line of text
 * — a room that meets every Tuesday is opened to find out what happened last
 * Tuesday.
 */
function Feature({
  album,
  t,
  width,
  onPress,
}: {
  album: GroupAlbum;
  t: GroupTheme;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${plural(album.photoCount, 'photo')}`}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.feature, { width, backgroundColor: t.line }]}>
        {album.cover && (
          <Image
            source={{ uri: album.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
          />
        )}
        {/*
          A ramp at the foot and nothing across the middle. Darkening a
          photograph to label it is the product having an opinion about
          somebody's picture; this is the least that carries white type.
        */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
          locations={[0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/*
          How many arrived since the last look, top right. A number rather than
          a dot: "since you last looked" is worth being precise about on a
          screen somebody visits weekly.
        */}
        {album.fresh > 0 && (
          <View style={[styles.fresh, { backgroundColor: t.accent }]}>
            <Text style={[styles.freshText, { color: t.onAccent }]}>{album.fresh} new</Text>
          </View>
        )}

        <View style={styles.featureFoot}>
          <Text style={styles.featureName} numberOfLines={1}>
            {album.name}
          </Text>
          <Text style={styles.featureMeta} numberOfLines={1}>
            {album.photoCount === 0
              ? 'Nothing in it yet'
              : `${plural(album.photoCount, 'photo')} · ${plural(album.people, 'person', 'people')}`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * One album on the shelf: a thumbnail and two lines.
 *
 * Everything behind the newest is here, and it is as much as an album from
 * March needs to be found by. The thumbnail is 76 by 95 — the cover's own 4:5
 * at a size that leaves the name room to be the thing you read.
 */
function Row({
  album,
  t,
  withMonth = false,
  onPress,
}: {
  album: GroupAlbum;
  t: GroupTheme;
  /** Under a year heading there is no month above the row to imply one. */
  withMonth?: boolean;
  onPress: () => void;
}) {
  const at = new Date(album.at);
  const when = Number.isNaN(at.getTime())
    ? null
    : new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        ...(withMonth ? { month: 'short' } : {}),
        timeZone: 'UTC',
      }).format(at);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${plural(album.photoCount, 'photo')}`}
      style={({ pressed }) => [styles.row, styles.gutter, { opacity: pressed ? 0.6 : 1 }]}
    >
      {album.cover ? (
        <Image
          source={{ uri: album.cover }}
          style={[styles.thumb, { backgroundColor: t.line }]}
          contentFit="cover"
          transition={120}
        />
      ) : (
        /* Dashed, which reads as "nothing here" rather than as a very dark
           photograph — the call the viewer's own shelf already makes. */
        <View style={[styles.thumb, styles.thumbEmpty, { borderColor: t.line }]} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowName, { color: t.fg }]} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={[styles.measured, styles.rowMeta, { color: t.dim }]} numberOfLines={1}>
          {[when, plural(album.photoCount, 'photo'), plural(album.people, 'person', 'people')]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {album.fresh > 0 && (
        <View style={[styles.rowPip, { backgroundColor: t.accent }]} />
      )}
    </Pressable>
  );
}

/**
 * Everybody in the room, behind the line that counts them.
 *
 * A sheet rather than a screen: it is a list of names with nothing to do on it
 * but leave or open one, which is the shape a sheet is for. The stack of faces
 * on the screen behind says who at a glance; this is the version you read.
 */
function Everyone({
  people,
  name,
  t,
  onOpenPerson,
  onClose,
}: {
  people: GroupPerson[];
  name: string;
  t: GroupTheme;
  onOpenPerson: (handle: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetShell}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Text style={[styles.label, { color: t.fg }]}>
            {plural(people.length, 'person', 'people')} in {name}
          </Text>
          <ScrollView style={styles.sheetList}>
            {people.map((person) => {
              const own = lensFor(person.actorId);
              return (
                <Pressable
                  key={person.actorId}
                  /* Only where there is a profile to open. Somebody who has not
                     chosen a handle has no page, and a control that does
                     nothing is worse than a label that never offered. */
                  onPress={person.handle ? () => onOpenPerson(person.handle!) : undefined}
                  disabled={!person.handle}
                  accessibilityRole={person.handle ? 'button' : 'text'}
                  style={({ pressed }) => [styles.personRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  {person.avatarUrl ? (
                    <Image
                      source={{ uri: person.avatarUrl }}
                      style={[styles.personFace, { backgroundColor: t.line }]}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <View style={[styles.personFace, styles.centred, { backgroundColor: own.fill }]}>
                      <Text style={[styles.personLetter, { color: own.ink }]}>
                        {initialOf(person.name)}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.body, { color: t.fg, flex: 1 }]} numberOfLines={1}>
                    {person.name}
                  </Text>
                  {/* Who runs the room, which is the only thing this list has
                      to say about anybody beyond their name. */}
                  {person.role === 'admin' && (
                    <Text style={[styles.small, { color: t.dim }]}>Runs it</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Everything else about the room, which is currently one thing.
 *
 * Its own sheet anyway, behind the same `⋯` an album's settings sit behind:
 * leaving was a red button at the foot of the archive, which put the screen's
 * one irreversible action at the end of the one list somebody scrolls to the
 * bottom of. A group that grows a second setting has somewhere to put it.
 */
function GroupMore({
  t,
  Button,
  onLeave,
  onClose,
}: {
  t: GroupTheme;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
  onLeave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetShell}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Text style={[styles.label, { color: t.fg }]}>This group</Text>
          <Text style={[styles.small, { color: t.dim }]}>
            Leaving stops the next album reaching you. It takes nothing away
            from the albums you were already in.
          </Text>
          <Button
            label="Leave this group"
            onPress={() => {
              onClose();
              onLeave();
            }}
            t={t}
          />
          <Button label="Close" onPress={onClose} t={t} />
        </View>
      </View>
    </Modal>
  );
}

/**
 * Finding a group by name — the backstop for a lost link.
 *
 * The only discovery surface in the product, and it returns doors. There is
 * deliberately no equivalent for events or photos: groups can be findable,
 * photos never are.
 */
export function GroupSearch({
  api,
  t,
  onOpen,
}: {
  api: Api;
  t: GroupTheme;
  onOpen: (groupId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; memberCount: number }[]>(
    [],
  );

  useEffect(() => {
    // Two characters is the server's floor, and typing through it should not
    // fire a request per keystroke.
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const found = await api.searchGroups(query).catch(() => []);
      if (live) setResults(found);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, query]);

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>Find a group by name</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Sunday roast"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
      />
      {results.map((group) => (
        <Pressable key={group.id} style={styles.listRow} onPress={() => onOpen(group.id)}>
          <Text style={[styles.body, { color: t.accent }]}>{group.name}</Text>
          <Text style={[styles.small, { color: t.dim }]}>
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /*
   * No horizontal padding on the scroll itself, because the newest album runs
   * to both edges. Everything that is not a photograph wears `gutter`, which
   * is the same trade the profile makes for the same reason.
   *
   * `paddingBottom` clears two things now: the floating tab bubble and the
   * "New album" pill above it.
   */
  scroll: { paddingTop: 72, paddingBottom: 168, gap: 18 },
  gutter: { paddingHorizontal: 20 },
  centred: { alignItems: 'center', justifyContent: 'center' },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  /* Inside a 36pt disc, so it needs no line height of its own to sit level. */
  back: { fontSize: 24, lineHeight: 26 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20 },
  /* The room's letter on its lens, at the size the Groups tab's tile draws it.
     Never a photograph borrowed from inside — see the note at the call site. */
  crest: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  crestLetter: { fontSize: 24, fontWeight: '700' },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3, lineHeight: 29 },

  /*
   * The one monospaced face in this product, and this screen uses it in three
   * places: under the group's name, on every month rule, and under every album
   * on the shelf. All three are the same kind of line — a measurement, a label
   * on the outside of a box — and the home card's own rule is set identically.
   *
   * `Menlo` on iOS and `monospace` on Android: React Native has no
   * `ui-monospace` keyword, and a missing family silently falls back to the
   * system face, which would make the one deliberate exception look like a bug.
   */
  measured: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  peopleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  /* Overlapped rather than spaced: the faces are one object — a group of
     people — and the width that gives back is what carries the line beside it. */
  stack: { flexDirection: 'row', flex: 0 },
  stackFace: { width: 30, height: 30, borderRadius: 8, borderWidth: 1.5, overflow: 'hidden' },
  stacked: { marginLeft: -8 },
  stackLetter: { fontSize: 12, fontWeight: '700' },
  stackMore: { fontSize: 11, fontWeight: '700' },
  everyone: { fontWeight: '600' },

  section: { gap: 10 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hair: { flex: 1, height: 1 },
  /* No upper-casing on the count: it is a number, and `textTransform` on a
     numeral is a rule doing nothing while looking like it might. */
  ruleCount: { textTransform: 'none' },

  /* Full-bleed and at the cover's own 4:5. The photograph is the row here, and
     an inset one with a rounded corner is an object on a page with the page
     showing round it. */
  feature: { aspectRatio: 4 / 5, marginHorizontal: -20, overflow: 'hidden', alignSelf: 'center' },
  featureFoot: { position: 'absolute', left: 20, right: 20, bottom: 14, gap: 1 },
  /* White with a shadow rather than on a bar: a block of chrome across the
     bottom of somebody's photograph is a caption that has become furniture. */
  featureName: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  featureMeta: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  fresh: {
    position: 'absolute',
    top: 12,
    right: 20,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  freshText: { fontSize: 11.5, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  /* The cover's own 4:5 at a size that leaves the name room to be the thing
     you read. Square corners, like every other photograph in the product. */
  thumb: { width: 76, height: 95, flex: 0 },
  thumbEmpty: { borderWidth: 1, borderStyle: 'dashed' },
  rowName: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  rowMeta: { marginTop: 4 },
  /* A dot rather than a count on the shelf: down here the number is precision
     nobody asked for, and the newest album above carries the real one. */
  rowPip: { width: 8, height: 8, borderRadius: 4, flex: 0 },

  /* The rule this screen ends on, and the only ruled-off block on it. */
  footnote: { marginTop: 14, paddingTop: 16, borderTopWidth: 1, fontSize: 12.5, lineHeight: 19 },

  /*
   * Making one, floating clear of the archive and above where the tab bubble
   * sits. Right-aligned, on the side the thumb that presses it comes from.
   */
  make: {
    position: 'absolute',
    right: 14,
    bottom: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  makeLabel: { fontSize: 15, fontWeight: '600' },

  sheetShell: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, gap: 12 },
  /* Capped, so a group of thirty is a list that scrolls inside the sheet
     rather than a sheet that is the whole screen. */
  sheetList: { maxHeight: 380 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  /* A rounded square, like every other face in this product: the profile's own
     picture, the home card's byline, the album's. A quarter of the box. */
  personFace: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden' },
  personLetter: { fontSize: 16, fontWeight: '700' },

  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  label: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  listRow: { paddingVertical: 10, gap: 2 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
