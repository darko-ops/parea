/**
 * Somebody else's page.
 *
 * The same screen the web draws at `/u/<handle>`, from the same endpoint and
 * with the same decision made once on the server — `profileFor` answers who
 * has a page and where you two stand, and neither client gets to hold an
 * opinion about it. "Two clients, one protocol" means the same thing is being
 * said in both places, not the same fields arriving.
 *
 * What it holds is a handle, whatever name they chose to show, their picture,
 * the one thing you can do about them, the events you are both in, and the
 * albums they made. The last of those is new and it is what "private" now
 * rests on: an album nobody can see exists is one nobody can ask to be let
 * into, and asking is one of the two ways in. A locked row carries a name and
 * nothing else — see `albumsBy` on the server.
 *
 * The rest of the omissions stand: no friend count, no event count, no
 * mutuals. Being findable leads to being able to ask and to nothing further.
 *
 * The events are the *viewer's* own, filtered to the ones this person is also
 * in. Every row was already in this app's own list a second ago, which is why
 * tapping one can open it: the link token is here already, and it is here
 * already because it was always yours.
 *
 * A person who is not there — a handle nobody has, a device that never signed
 * in, either side of a block — is one message and the same one. Telling those
 * apart is how a screen becomes a way to ask whether somebody exists.
 */

import { dateLabel } from '@parea/cards';
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { Api, EventListing, Person, ProfileAlbum, SharedEvent, Standing } from './api';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Waiting } from './Waiting';

/** The shelf's shape, matching the one the viewer's own profile draws. */
const COLUMNS = 2;
const GAP = 10;

/**
 * What we call somebody: their name if they gave one, else the handle.
 *
 * A name is bare and a handle wears its `@`, which is the distinction the
 * sigil is for: it is not decoration on a person, it is what marks the string
 * as the thing you can type at a search box. So the fallback keeps it — what
 * is standing in for the name here *is* a handle, and stripping the `@` would
 * make it read as somebody whose name happens to be lowercase.
 */
function nameOf(person: Person): string {
  return person.displayName?.trim() || `@${person.handle}`;
}

export function PersonScreen({
  api,
  handle,
  events,
  t,
  onBack,
  onOpenEvent,
  Button,
}: {
  api: Api;
  handle: string;
  /**
   * This app's own list of events, for opening a shared one.
   *
   * The server says which events you are both in; it does not hand over a way
   * in, because it does not need to — every one of them is already in the list
   * this app loaded for the home tab, link token and all.
   */
  events: EventListing[];
  t: GroupTheme;
  onBack: () => void;
  onOpenEvent: (event: EventListing) => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const { width } = useWindowDimensions();

  const [person, setPerson] = useState<Person | null>(null);
  const [shared, setShared] = useState<SharedEvent[]>([]);
  const [albums, setAlbums] = useState<ProfileAlbum[]>([]);
  /** Album id → what the server said the last ask left standing. */
  const [asked, setAsked] = useState<Record<string, string>>({});
  const [standing, setStanding] = useState<Standing>('none');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .person(handle)
      .then((body) => {
        if (!live) return;
        setPerson(body.person);
        setStanding(body.person.standing);
        setShared(body.shared);
        setAlbums(body.albums ?? []);
        setError(null);
      })
      .catch(() => {
        if (live) setError('That person is not available.');
      });
    return () => {
      live = false;
    };
  }, [api, handle]);

  const ask = useCallback(async () => {
    if (!person) return;
    setBusy(true);
    try {
      const body = await api.askFriend(person.actorId);
      // `accepted` happens when this crossed with an ask of theirs: the
      // endpoint answers the open request rather than opening a second one,
      // and the screen should say what is now true.
      setStanding(body.status === 'accepted' ? 'friends' : 'asked');
    } catch {
      setError('Could not send that. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, person]);

  /**
   * Taking the ask back.
   *
   * The button that says so is the same button: "Requested" is a state you are
   * in and pressing it is how you leave it, which is the only reading of a
   * pressable control that reports a state. Nothing is confirmed first —
   * withdrawing costs nothing and asking again is one press away, so a dialog
   * here would be guarding the wrong direction.
   *
   * `unaskFriend` clears both open requests between the two of you, so a
   * withdrawal leaves nothing behind for the next ask to collide with.
   */
  const unask = useCallback(async () => {
    if (!person) return;
    setBusy(true);
    try {
      await api.unaskFriend(person.actorId);
      setStanding('none');
      setError(null);
    } catch {
      setError('Could not take that back. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, person]);

  /**
   * Asking to be let into one of their private albums.
   *
   * Optimistic about nothing: the row says what the server said, because a
   * repeat ask on something already declined comes back `declined` rather than
   * reopening it, and a screen that showed "Asked" over that would be pressing
   * past somebody's no on their behalf.
   */
  const askToJoin = useCallback(
    async (album: ProfileAlbum) => {
      setBusy(true);
      try {
        const body = await api.askToJoin(album.id);
        setAsked((was) => ({ ...was, [album.id]: body.status ?? 'open' }));
      } catch {
        setError('Could not ask just now. Try again in a moment.');
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const answer = useCallback(
    async (yes: boolean) => {
      if (!person?.requestId) return;
      setBusy(true);
      try {
        await api.answerFriend(person.requestId, yes);
        setStanding(yes ? 'friends' : 'none');
      } catch {
        setError('Could not answer that. Try again in a moment.');
      } finally {
        setBusy(false);
      }
    },
    [api, person],
  );

  if (error && !person) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={onBack}>
          <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.body, { color: t.dim }]}>{error}</Text>
      </ScrollView>
    );
  }

  if (!person) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Waiting size={40} />
      </View>
    );
  }

  const name = nameOf(person);
  /*
   * The letter and its colour, keyed on the handle exactly as the viewer's
   * own profile keys its own — so somebody is the same colour on their page
   * as they are in a thread, in a group's people row and over a cover.
   */
  const lens = lensFor(person.handle);

  /** The tile edge, from the window rather than a constant, as the profile's is. */
  const tile = Math.floor((width - 40 - GAP * (COLUMNS - 1)) / COLUMNS);

  /**
   * One shelf, from two lists that arrive separately.
   *
   * `shared` is the viewer's own albums filtered to the ones this person is
   * also in, so every row of it is already in `events` and carries a cover, a
   * count and a date this app fetched for itself. `albums` is everything they
   * made that the first list does not already hold, and a locked one carries a
   * name and nothing else — see `albumsBy` on the server.
   *
   * Drawn as one grid because they are one thing to the person reading: what
   * this person has. The two were separate cards under separate headings,
   * which said more about where the data came from than about them.
   */
  const shelf = [
    ...shared.map((event) => {
      const mine = events.find((e) => e.id === event.id);
      return {
        id: event.id,
        name: event.name,
        cover: mine?.cover?.src ?? event.thumb,
        photoCount: mine?.photoCount ?? null,
        // When the album was made, which is what every shelf of them shows.
        at: mine?.createdAt ?? event.lastActiveAt,
        locked: false,
        open: mine ? () => onOpenEvent(mine) : null,
        album: null as ProfileAlbum | null,
      };
    }),
    ...albums.map((album) => ({
      id: album.id,
      name: album.name,
      cover: album.thumb,
      photoCount: album.photoCount,
      at: album.createdAt,
      locked: album.locked,
      open: null,
      album,
    })),
  ];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={[styles.back, { color: t.accent }]}>‹</Text>
      </Pressable>

      {/*
        The same head their own profile has: the name and the handle on the
        left, the picture bleeding off the right edge.

        It was a bordered card with a 64pt circle in it — a row in a settings
        list, for the one screen in the product that is a person. Somebody
        arriving here from a byline should find the same shape they find on
        their own page, because it is the same kind of page.
      */}
      <View style={styles.head}>
        <View style={styles.who}>
          <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
            {name}
          </Text>
          {/* Always, and not only under a display name: the handle is the
              durable half and the thing this page is reached by. With its `@`,
              which is what says it is a handle and not a second name. */}
          <Text style={[styles.handle, { color: t.dim }]} numberOfLines={1}>
            @{person.handle}
          </Text>
          {/*
            The three their own profile prints, in the same order and at the
            same size.

            This page used to print one number — how many of *your* albums they
            are in — on the argument that their own totals would make search a
            way to measure strangers. The shelf below undid that argument on
            its own: every album they made is already listed there by name,
            locked ones included, so the count above it says nothing new and
            saves somebody scrolling to find out how much there is.

            The line about the two of you did not survive the swap and should
            not have: it is the shelf's own answer, said again in figures, and
            two counts of albums on one screen is a screen you have to work
            out. See `ProfileCounts` on the server for what each one counts.
          */}
          <Text style={[styles.counts, { color: t.dim }]}>
            {person.counts.albums} {person.counts.albums === 1 ? 'album' : 'albums'} ·{' '}
            {person.counts.photos} {person.counts.photos === 1 ? 'photo' : 'photos'} ·{' '}
            {person.counts.friends} {person.counts.friends === 1 ? 'friend' : 'friends'}
          </Text>
        </View>

        {person.avatar ? (
          <Image
            source={{ uri: person.avatar }}
            style={[styles.avatar, { backgroundColor: t.line }]}
          />
        ) : (
          /*
            A letter on their own lens, never a silhouette — the rule every
            face in this product follows.

            In the picture's own shape, which is the half this was missing: a
            64pt circle in the gutter where a photograph would be a 124×104
            panel running off the right edge meant somebody with no picture had
            a visibly different page from somebody with one, and a smaller one.
            The shape belongs to the slot, not to what happens to be in it.
          */
          <View style={[styles.avatar, styles.avatarBlank, { backgroundColor: lens.fill }]}>
            <Text style={[styles.avatarLetter, { color: lens.ink }]}>
              {initialOf(name)}
            </Text>
          </View>
        )}
      </View>

      {person.bio && <Text style={[styles.bio, styles.gutter, { color: t.fg }]}>{person.bio}</Text>}

      {/*
        Where Edit profile and Share profile sit on your own, there is one
        control here and it is the only thing you can do about somebody.

        The quiet standings are worn as a label rather than offered as a
        button: "Friends" and "Asked" are states, and a control that reports a
        state is a control somebody presses to find out it does nothing. The
        one that is genuinely somebody's to answer — they asked you — is two
        buttons, because it is the one case with a decision in it.
      */}
      <View style={[styles.actions, styles.gutter]}>
        {standing === 'none' && (
          <Pressable
            onPress={ask}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.action,
              { borderColor: t.fg, opacity: busy ? 0.5 : pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.actionText, { color: t.fg }]}>Add friend</Text>
          </Pressable>
        )}
        {standing === 'friends' && (
          <View
            style={[styles.action, { borderColor: t.line, backgroundColor: t.card }]}
            accessibilityRole="text"
          >
            <Text style={[styles.actionText, { color: t.dim }]}>Friends</Text>
          </View>
        )}
        {/*
          "Requested", and pressing it takes the request back.

          It said "Asked" and it was a label — a state worn rather than
          offered, on the argument that a control reporting a state is one
          somebody presses to find out it does nothing. That argument only
          holds while there is nothing to do: an open request is somebody's own
          to withdraw, so the flat panel was the page keeping the one thing
          left in the viewer's gift out of reach, and the only way out of
          "Asked" was for the other person to answer.

          The word changed with it. "Asked" is the past tense of what you did;
          "Requested" is the state it left you in, which is what a control
          standing for a state should say — and it is the word the rest of the
          world has taught people to press to undo exactly this.
        */}
        {standing === 'asked' && (
          <Pressable
            onPress={() => void unask()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Requested. Press to take your request back"
            style={({ pressed }) => [
              styles.action,
              {
                borderColor: t.line,
                backgroundColor: t.card,
                opacity: busy ? 0.5 : pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.actionText, { color: t.dim }]}>Requested</Text>
          </Pressable>
        )}
        {standing === 'asking' && (
          <>
            <Pressable
              onPress={() => void answer(true)}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.action,
                { borderColor: t.fg, opacity: busy ? 0.5 : pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.actionText, { color: t.fg }]}>Accept</Text>
            </Pressable>
            <Pressable
              onPress={() => void answer(false)}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.action,
                { borderColor: t.line, backgroundColor: t.card, opacity: busy ? 0.5 : pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.actionText, { color: t.dim }]}>Decline</Text>
            </Pressable>
          </>
        )}
      </View>

      {standing === 'asking' && (
        <Text style={[styles.small, styles.gutter, { color: t.dim }]}>
          {name} asked to be friends.
        </Text>
      )}
      {error && <Text style={[styles.small, styles.gutter, { color: t.dim }]}>{error}</Text>}

      {/*
        The shelf, in the grid their own profile uses.

        Two cards of text rows became one wall of covers, which is the point of
        the screen: what this person has is photographs, and a list of names in
        a bordered panel is a directory of them.
      */}
      {/*
        What the padlocks mean, said once above them rather than per tile.

        A wall of shut doors is a page that looks like a refusal; the sentence
        is what turns it into a queue. It is only here while there is something
        shut and a way to open it — friends see the insides, so a friend
        reading this would be told to do something they have already done.
      */}
      {standing !== 'friends' && shelf.some((item) => item.locked) && (
        <Text style={[styles.small, styles.gutter, { color: t.dim }]}>
          Become friends to see what&rsquo;s inside.
        </Text>
      )}

      {shelf.length === 0 ? (
        <Text style={[styles.body, styles.gutter, { color: t.dim }]}>
          {/*
            Two ways of having none, and they are different sentences. A friend
            with nothing shared is told it is not there *yet*, which is a fact
            about the two of you and likely to change.
          */}
          {standing === 'friends' ? 'No albums to show yet' : 'Nothing here yet'}
        </Text>
      ) : (
        <View style={[styles.grid, styles.gutter]}>
          {shelf.map((item) => {
            const status = item.album ? asked[item.album.id] : undefined;
            const when = dateLabel(item.at);
            return (
              <View key={item.id} style={{ width: tile }}>
                <Pressable
                  onPress={
                    item.open ??
                    (item.locked && item.album && !status
                      ? () => void askToJoin(item.album!)
                      : undefined)
                  }
                  disabled={!item.open && !(item.locked && item.album && !status)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    item.locked ? `${item.name}, private. Ask to join` : item.name
                  }
                >
                  {item.cover ? (
                    <Image source={{ uri: item.cover }} style={styles.tile} />
                  ) : (
                    /*
                      A locked album has no thumbnail to draw and it is not a
                      picture that failed: a dashed empty tile, which is what is
                      actually being said. The same tile stands in for an
                      unlocked one that simply has no cover yet.

                      The padlock tells the two apart, and it is the same glyph
                      an album's own header wears to mean private — so the
                      thing that means "shut" means it in one shape across the
                      app. An empty unlocked album keeps the bare frame: there
                      is nothing being withheld from anybody there.
                    */
                    <View style={[styles.tile, styles.tileEmpty, { borderColor: t.line }]}>
                      {item.locked && <Glyph name="locked" size={22} color={t.dim} />}
                    </View>
                  )}
                </Pressable>
                <Text style={[styles.tileName, { color: t.fg }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.tileMeta, { color: t.dim }]} numberOfLines={1}>
                  {item.locked
                    ? status
                      ? status === 'approved'
                        ? 'Let in'
                        : 'Asked'
                      : 'Private · ask to join'
                    : item.photoCount === null || item.photoCount === 0
                      ? 'Nothing in it yet'
                      : when
                        ? `${when} · ${item.photoCount}`
                        : `${item.photoCount} ${item.photoCount === 1 ? 'photo' : 'photos'}`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /*
   * No horizontal padding on the scroll itself, because the picture runs off
   * the right edge. Everything that is not the picture wears `gutter`, which
   * is the same trade the viewer's own profile makes for the same reason.
   */
  scroll: { paddingTop: 72, paddingBottom: 132, gap: 14 },
  gutter: { paddingHorizontal: 20 },
  back: { fontSize: 28, lineHeight: 30, paddingHorizontal: 20 },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13 },
  /* The name block and the picture, the picture bleeding off the right. */
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20 },
  who: { flex: 1, minWidth: 0, gap: 3, paddingRight: 16 },
  name: { fontSize: 28, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  handle: { fontSize: 15 },
  counts: { fontSize: 15 },
  /*
   * The same picture the viewer's own profile draws, at the same size and with
   * the same corner: rounded on the left, square on the right, because it runs
   * off the edge of the screen rather than sitting on it.
   */
  avatar: {
    width: 124,
    height: 104,
    borderTopLeftRadius: 26,
    borderBottomLeftRadius: 26,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  /* Only what a letter needs on top of the panel it sits in: `avatar` above
     carries the size and the corners, so the two states are the same slot. */
  avatarBlank: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 34, fontWeight: '700' },
  bio: { fontSize: 15, lineHeight: 21 },
  /* One control where the profile has two, and it fills the row on its own. */
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '600' },
  /* Two across with gutters: these are separate albums, not one object the
     way a wall of photographs would be. */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { width: '100%', height: 120, borderRadius: 12, backgroundColor: '#8881' },
  tileEmpty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Under the picture rather than over it: a scrim block across the bottom of
     every tile is a grid that reads as captioned stock photography. */
  tileName: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  tileMeta: { fontSize: 12.5, marginTop: 1 },
});
