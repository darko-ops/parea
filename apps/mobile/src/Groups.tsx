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

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api, GroupAlbum, GroupRoom, GroupView, JoinRequest } from './api';
import { Glyph } from './Glyph';
import { initialOf, lensFor } from './lens';
import { Waiting } from './Waiting';

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
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headRow}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={[styles.back, { color: t.accent }]}>‹</Text>
        </Pressable>
        {group.member && (
          /*
            Into the conversation, from the corner the album's `⋯` sits in.

            The room had no way to reach its own thread: you got there from the
            envelope on the Groups tab, so a group opened from a search result
            or from an album was a room with the talking sealed off.
          */
          <Pressable
            onPress={() => onOpenThread(group)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Talk in ${group.name}`}
            style={[styles.thread, { borderColor: t.line, backgroundColor: t.card }]}
          >
            <Glyph name="plane" size={17} color={t.fg} />
          </Pressable>
        )}
      </View>

      {/*
        The room's own face: its letter on its lens, at the size the tile on
        the Groups tab draws it.

        Never a photograph borrowed from inside. That rule is older than this
        screen and holds here for the reason it holds on the door — a picture
        from one evening standing for the room says that evening is the room.
      */}
      <View style={styles.identity}>
        <View style={[styles.crest, { backgroundColor: lens.fill }]}>
          <Text style={[styles.crestLetter, { color: lens.ink }]}>{initialOf(group.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.h1, { color: t.fg }]}>{group.name}</Text>
          <Text style={[styles.small, { color: t.dim }]}>
            {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
            {group.member && group.events.length > 0 &&
              ` · ${group.events.length} ${group.events.length === 1 ? 'album' : 'albums'}`}
            {group.member && group.role === 'admin' && ' · you run it'}
          </Text>
        </View>
      </View>

      {!group.member ? (
        // The door. Deliberately spare: a name and a count is everything a
        // non-member is told, and the button says which of the two things is
        // about to happen rather than making them find out.
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.body, { color: t.fg }]}>
            {group.canJoinDirectly
              ? 'You were at one of this group’s albums, so you can join without asking.'
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
            Who is in the room, as faces rather than as a number.

            The count above says how many; this says who, which is the half
            somebody actually recognises a room by. A row that scrolls rather
            than a wrapped block: a group of thirty would otherwise push the
            albums — the thing this screen is for — off the bottom of it.
          */}
          {group.people.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.peopleRow}
            >
              {group.people.map((person) => {
                const own = lensFor(person.actorId);
                return (
                  <Pressable
                    key={person.actorId}
                    /*
                      Only where there is a profile to open. Somebody who has
                      not chosen a handle has no page, and a control that does
                      nothing is worse than a label that never offered — the
                      rule every other face in this product follows.
                    */
                    onPress={person.handle ? () => onOpenPerson(person.handle!) : undefined}
                    disabled={!person.handle}
                    accessibilityRole={person.handle ? 'button' : 'text'}
                    accessibilityLabel={
                      person.role === 'admin' ? `${person.name}, runs this group` : person.name
                    }
                    style={styles.person}
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
                    <Text style={[styles.personName, { color: t.dim }]} numberOfLines={1}>
                      {person.firstName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {group.role === 'admin' && requests.length > 0 && (
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
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

          {/*
            The archive, and it is the screen now.

            It was a card containing the album names as blue words with a raw
            date beside each — a list of links, in a product whose subject is
            photographs, describing the one place a group's photographs
            accumulate. The server has been able to answer this properly for a
            while: the web's group page draws covers and counts out of
            `groupArchive`, and the route the app asks was still returning four
            bare columns.

            Grouped under the month, contiguously rather than collected. The
            list arrives newest-first, so a month's albums are already
            together; building a map would quietly reorder them if that ever
            stopped being true, where this draws the same heading twice — which
            is visibly wrong rather than silently rearranged. Same rule the web
            page follows.
          */}
          {group.events.length === 0 ? (
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={[styles.body, { color: t.dim }]}>
                Nothing yet. The next album anybody makes in this group shows up
                here, and everyone gets told.
              </Text>
            </View>
          ) : (
            monthsOf(group.events).map((month) => (
              <View key={month.label} style={styles.month}>
                <View style={styles.monthHead}>
                  <Text style={[styles.monthLabel, { color: t.dim }]}>{month.label}</Text>
                  <View style={[styles.rule, { backgroundColor: t.line }]} />
                </View>
                {month.events.map((event) => (
                  <AlbumRow
                    key={event.id}
                    album={event}
                    t={t}
                    onPress={() =>
                      onOpenEvent({
                        id: event.id,
                        name: event.name,
                        linkToken: event.linkToken,
                        // Carried through so an album opened from here can
                        // still auto-select. Losing them silently drops every
                        // grouped album to the system picker.
                        startsAt: event.startsAt,
                        endsAt: event.endsAt,
                      })
                    }
                  />
                ))}
              </View>
            ))
          )}

          {/*
            Any member, not just an admin: the point of a group is that the
            next dinner does not need the person who made the last one. This
            is also the only producer of §12's second notification.
          */}
          <Button
            label="New album in this group"
            onPress={() => onCreateEvent(group.name)}
            t={t}
            primary
          />

          <Button label="Leave this group" onPress={leave} t={t} />
        </>
      )}
    </ScrollView>
  );
}

/**
 * One album in the room: its picture, its name, and what is in it.
 *
 * Full-bleed against the screen's gutter, like the cards on the home list and
 * for the same reason — the photograph is the row, and an inset one with a
 * rounded corner is an object on a page with the page showing round it.
 *
 * The cover is drawn at 4:5 rather than at the album's own shape. A column of
 * covers at their natural heights is a ladder of different rectangles, which
 * reads as a feed; one shape down the page reads as an archive, which is what
 * a group is. The home list is the place that keeps each evening's proportions.
 */
function AlbumRow({
  album,
  t,
  onPress,
}: {
  album: GroupAlbum;
  t: GroupTheme;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${album.photoCount} ${
        album.photoCount === 1 ? 'photo' : 'photos'
      }`}
      style={({ pressed }) => [styles.album, { opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={[styles.albumShot, { backgroundColor: t.line }]}>
        {album.cover && (
          <Image
            source={{ uri: album.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
          />
        )}
        {/*
          Just enough shadow at the foot to carry white, and nothing across the
          middle. Darkening a photograph to label it is the product having an
          opinion about somebody's picture.
        */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
          locations={[0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/*
          How many arrived since the last look, top right.

          A number rather than a dot: "since you last looked" is worth being
          precise about on a screen somebody visits weekly, and the pip it
          replaces said only that *something* had happened.
        */}
        {album.fresh > 0 && (
          <View style={[styles.fresh, { backgroundColor: t.accent }]}>
            <Text style={[styles.freshText, { color: t.onAccent }]}>{album.fresh} new</Text>
          </View>
        )}

        <View style={styles.albumFoot}>
          <Text style={styles.albumName} numberOfLines={1}>
            {album.name}
          </Text>
          <Text style={styles.albumMeta} numberOfLines={1}>
            {album.photoCount === 0
              ? 'Nothing in it yet'
              : `${album.photoCount} ${album.photoCount === 1 ? 'photo' : 'photos'}`}
            {album.people > 0 &&
              ` · ${album.people} ${album.people === 1 ? 'person' : 'people'}`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The albums under the month they belong to, in the order they arrived in.
 *
 * Contiguous runs rather than a map keyed by month: the list is sorted
 * newest-first by the server, so a month's albums are already together, and a
 * map would quietly reorder them if that ever stopped being true. This draws
 * the same heading twice instead, which is visibly wrong rather than silently
 * rearranged. The web's group page groups the same way.
 */
function monthsOf(events: GroupAlbum[]): { label: string; events: GroupAlbum[] }[] {
  const now = new Date();
  const months: { label: string; events: GroupAlbum[] }[] = [];
  for (const event of events) {
    const at = new Date(event.at);
    const label = Number.isNaN(at.getTime())
      ? 'Undated'
      : new Intl.DateTimeFormat('en-GB', {
          month: 'long',
          // The year only where it is not this one — "August 2024" tells two
          // summers apart, and "August 2026" in September 2026 is noise.
          ...(at.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }),
          timeZone: 'UTC',
        }).format(at);
    const last = months[months.length - 1];
    if (last && last.label === label) last.events.push(event);
    else months.push({ label, events: [event] });
  }
  return months;
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
  /* `paddingBottom` clears the floating tab bubble, which this screen scrolls
     underneath. 20 alone left the last button half behind glass. */
  scroll: { padding: 20, paddingTop: 72, paddingBottom: 132, gap: 14 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 28, lineHeight: 30 },
  /* The same 36pt bordered disc the rest of the product makes and opens things
     with — one shape for "a control in a corner", wherever it is. */
  thread: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  /* The room's letter on its lens, at the size the Groups tab's tile draws it.
     Never a photograph borrowed from inside — see the note at the call site. */
  crest: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  crestLetter: { fontSize: 24, fontWeight: '700' },
  peopleRow: { gap: 14, paddingVertical: 2, paddingRight: 20 },
  person: { width: 52, alignItems: 'center', gap: 5 },
  /* A rounded square, like every other face in this product: the profile's own
     picture, the home card's byline, the album's. A quarter of the box. */
  personFace: { width: 44, height: 44, borderRadius: 11, overflow: 'hidden' },
  personLetter: { fontSize: 17, fontWeight: '700' },
  personName: { fontSize: 11.5, maxWidth: 52 },
  month: { gap: 10 },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /* Upper-cased and monospaced, like the rule over a card on the home list:
     the two are the same kind of line — a label on the outside of a box — and
     a second treatment for one idea is how a product comes to have two. */
  monthLabel: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  rule: { flex: 1, height: 1 },
  /* Full-bleed against the scroll's gutter, like the cards on the home list:
     the photograph is the row, and an inset one with a rounded corner is an
     object on a page with the page showing round it. */
  album: { marginHorizontal: -20 },
  /* One shape down the page rather than each album's own. A column of covers
     at their natural heights is a ladder of different rectangles, which reads
     as a feed; the home list is the place that keeps an evening's proportions. */
  albumShot: { width: '100%', aspectRatio: 4 / 5, overflow: 'hidden' },
  albumFoot: { position: 'absolute', left: 20, right: 20, bottom: 14, gap: 1 },
  /* White with a shadow rather than on a bar: a block of chrome across the
     bottom of somebody's photograph is a caption that has become furniture. */
  albumName: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  albumMeta: {
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
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  listRow: { paddingVertical: 10, gap: 2 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
