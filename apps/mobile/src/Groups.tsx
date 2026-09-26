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
 *
 * ## The room is shaped like an album
 *
 * A head that stays put, a row of three tabs, and one pane at a time: Albums,
 * Chat, People. An evening and a room are the same kind of object to somebody
 * holding the phone — a thing with pictures in it, a conversation about them,
 * and the people it belongs to — and drawing them two ways makes a reader
 * learn the product twice.
 *
 * Three things went to make room for it, and each was a decision worth
 * stating:
 *
 *   - **The archive.** The newest album was full-bleed at 4:5 with the rest
 *     shelved under month and year rules, which reads well on its own and
 *     reads like a third kind of album list. The Albums tab is the profile's
 *     shelf — two across, cover, name, date and count — because these are the
 *     same objects that shelf holds.
 *   - **The chat disc.** A button in the header that opened a screen with a
 *     second header naming the group you had just left. It is a tab, which is
 *     where a room's conversation belongs: one of the things this screen is
 *     about rather than somewhere else to go.
 *   - **The Everyone sheet.** A modal over a stack of faces, which is a pane
 *     with a lid on it. The People tab is that list, and the join requests an
 *     admin used to meet above the archive sit at the top of it with the count
 *     on the tab — the same pip an album's Comments tab carries.
 *
 * What did not change is the crest. A group's face is its letter on its own
 * lens and never a photograph borrowed from inside, because a picture from one
 * evening standing for the room says that evening is the room.
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

import type { Api, GroupAlbum, GroupView, JoinRequest } from './api';
import { Glyph, type GlyphName } from './Glyph';
import { GroupChat } from './GroupThread';
import { initialOf, lensFor } from './lens';
import { More, RoundButton } from './RoundButton';
import { Waiting } from './Waiting';

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * How tall the head is, and therefore where the panes begin.
 *
 * An album's cover is 196 and this is shorter, because what is in it is a
 * crest and two lines rather than a photograph: a panel does not need a third
 * of the screen. `PAGE_TOP` in `App.tsx` is the same idea and the same pair of
 * constants.
 */
const HEAD = 176;

/** Two across: at this width a cover is a photograph rather than a swatch. */
const COLUMNS = 2;
/** Gutters rather than hairlines — these tiles are cards, not one object. */
const GAP = 10;

/** Structural rather than imported, to keep this file out of App's import cycle. */
export type GroupTheme = {
  bg: string;
  fg: string;
  dim: string;
  card: string;
  line: string;
  accent: string;
  onAccent: string;
  /**
   * The one unread colour, and it is the logo's aqua — see `theme` in
   * `App.tsx`. Every mark that means "something arrived while you were away"
   * is painted in it: the dot on the Chats tab, the count on a conversation,
   * the badge on the tray. Separate from `accent`, which is what a button is.
   */
  news: string;
  /** Ink for text sitting on `news`, which is a light value. */
  onNews: string;
  /**
   * The mark's pink, for the one mark that is not about news: the dot on the
   * Chats tab. Its own colour because it and the tray can be lit at once and
   * they point at two different screens — see `theme` in `App.tsx`.
   */
  said: string;
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
  onOpenPerson,
  Button,
}: {
  api: Api;
  groupId: string;
  t: GroupTheme;
  onBack: () => void;
  onOpenEvent: (event: OpenableEvent) => void;
  onCreateEvent: (groupName: string) => void;
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
  /**
   * Which of the three panes is open.
   *
   * The same shape an album has, for the same reason: a room is a set of
   * things about one subject, and stacking them makes the screen a scroll
   * through everything on the way to the one you wanted. Albums first, because
   * a room that keeps meeting is opened to see what it has been doing.
   */
  const [pane, setPane] = useState<GroupPane>('albums');
  /** Everything else about the room, which is still one thing: leaving. */
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

  /**
   * Naming the room, or clearing the name back off it.
   *
   * The whole view is read again rather than the name being patched into the
   * one in hand, because naming changes more than the heading: the crest
   * stops being the people and becomes a letter, and the room appears on
   * Find's shelf it was not on. The route answers with the new title, and
   * taking that alone would leave the screen agreeing with itself and wrong
   * about everything the title implies.
   *
   * A failure leaves the room as it was and says nothing. It is the only
   * cosmetic write on this screen; an alert over a group because a name did
   * not save is louder than the thing that did not happen.
   */
  const rename = useCallback(
    async (name: string) => {
      await api.nameGroup(groupId, name).catch(() => null);
      setGroup(await api.group(groupId).catch(() => null));
    },
    [api, groupId],
  );

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
   * How wide one album is, on a screen this wide.
   *
   * Two across, which is the profile's shelf and now this one — see the note
   * at the top of the file about what it replaced. The arithmetic is that
   * file's too: the gutter twice, and the gap between the columns.
   */
  const tile = Math.floor((width - 40 - GAP * (COLUMNS - 1)) / COLUMNS);

  if (error) {
    return (
      <ScrollView contentContainerStyle={styles.doorScroll}>
        <View style={styles.gutter}>
          <Pressable onPress={onBack}>
            <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
          </Pressable>
          <Text style={[styles.body, { color: t.dim }]}>{error}</Text>
        </View>
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
    <View style={{ flex: 1 }}>
      {/*
        The room's head, which stays put while the panes change under it.

        An album's does the same and the shape is borrowed from it deliberately
        — a cover, then a row of tabs, then whichever of the three you are
        looking at. What a group has instead of a cover is its crest: a letter
        on its own lens, never a photograph borrowed from inside, because a
        picture from one evening standing for the room says that evening *is*
        the room.

        Fixed height, like the album's cover, so the tabs never move. A long
        name is clamped to two lines rather than pushing them down.
      */}
      <View style={[styles.head, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <View style={styles.headRow}>
          <RoundButton t={t} onPress={onBack} accessibilityLabel="Back">
            <Text style={[styles.back, { color: t.fg }]}>‹</Text>
          </RoundButton>

          {group.member && (
            /*
              Everything else about the room, behind the same `⋯` an album's
              own settings sit behind. The chat disc that was beside it is a
              tab now, which is where a room's conversation belongs: it is one
              of the things this screen is about rather than somewhere else to
              go.
            */
            <RoundButton t={t} onPress={() => setMore(true)} accessibilityLabel="Group settings">
              <More color={t.fg} />
            </RoundButton>
          )}
        </View>

        <View style={styles.identity}>
          {/*
            The crest: a letter on the room's own lens, and a letter is what a
            *named* room has. A room called "Ana, Jack + 2 more" has no
            initial worth drawing — the A would be a fact about Ana — so an
            unnamed one wears the first thing in its title all the same, which
            is a person, and reads as a person.

            The deck of members belongs here too and is not drawn yet: this
            screen is fetched through `GroupView`, which carries `people`
            rather than the deck the lists carry. `RoomMark` on the Chats tab
            is the shape it should take when it does.
          */}
          <View style={[styles.crest, { backgroundColor: lens.fill }]}>
            <Text style={[styles.crestLetter, { color: lens.ink }]}>{initialOf(group.name)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.h1, { color: t.fg }]} numberOfLines={2}>
              {group.name}
            </Text>
            {/*
              How much is in here, and how long it has been going.

              Set in the monospaced line the rest of the product measures
              things with — an album's own rule is the same face for the same
              reason: these are facts about a box rather than something
              somebody wrote.

              A member count used to be half of this and is not, because the
              People tab says it better. What a count cannot say is *since
              March 2024*, and a group's age is most of what makes it read as
              a room rather than as a list.
            */}
            {group.member && (
              <Text style={[styles.measured, { color: t.dim }]} numberOfLines={1}>
                {`${plural(group.events.length, 'album')} · since ${sinceOf(group.createdAt)}`}
              </Text>
            )}
          </View>
        </View>
      </View>

      {!group.member ? (
        /*
          The door, which has no panes to switch between.

          Deliberately spare: a name and a count is everything a non-member is
          told, and the button says which of the two things is about to happen
          rather than making them find out. There is nothing to tab through —
          no albums, no conversation and no list of people — so the screen does
          not draw a row of tabs that would all be empty.
        */
        <ScrollView contentContainerStyle={styles.doorScroll}>
          <View style={[styles.card, styles.gutter, { backgroundColor: t.card, borderColor: t.line }]}>
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
        </ScrollView>
      ) : (
        <View style={styles.page}>
          {/*
            The three, and the one thing this room can do that is not looking
            at it.

            The `+` sits where an album's "add photos" sits and does the room's
            version of the same job. It was a floating pill above the tab
            bubble, put there because the control for adding was at the foot of
            the one list somebody scrolls to the bottom of — a tab row pinned
            over the pane solves that without a second floating object, and it
            is what the album screen already does.
          */}
          <View style={styles.tabRow}>
            <Tabs pane={pane} onPane={setPane} t={t} waiting={requests.length} />
            <Pressable
              onPress={() => onCreateEvent(group.name)}
              accessibilityRole="button"
              accessibilityLabel="New album in this group"
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Glyph name="plus" size={18} color={t.fg} />
            </Pressable>
          </View>

          {pane === 'albums' ? (
            <ScrollView contentContainerStyle={styles.paneScroll}>
              {group.events.length === 0 ? (
                <View style={[styles.card, styles.gutter, { backgroundColor: t.card, borderColor: t.line }]}>
                  <Text style={[styles.body, { color: t.dim }]}>
                    Nothing yet. The next album anybody makes in this group shows
                    up here, and everyone gets told.
                  </Text>
                </View>
              ) : (
                /*
                  The shelf, two across, exactly as a profile draws one.

                  It was an archive: the newest album full-bleed at 4:5, then
                  the rest as rows under month and year rules. That reads well
                  and it reads like *a third thing* — a group's albums are the
                  same objects the profile shelves, and drawing them two ways
                  makes somebody learn the product twice. The date each row's
                  rule was carrying is under every tile, which is where the
                  profile has always put it.
                */
                <View style={[styles.grid, styles.gutter]}>
                  {group.events.map((album) => (
                    <AlbumTile
                      key={album.id}
                      album={album}
                      t={t}
                      width={tile}
                      onPress={() => openAlbum(album)}
                    />
                  ))}
                </View>
              )}

              {/*
                What a group is, said once, at the bottom.

                Leaving is behind the `⋯` and an alert asks before it happens,
                but an alert is read by somebody who has already decided. This
                is the sentence for somebody deciding — and it is at the foot
                of the albums because that is where you arrive having scrolled
                them, which is exactly when "what happens to all this if I go"
                occurs to you.
              */}
              <Text style={[styles.footnote, styles.gutter, { color: t.dim, borderTopColor: t.line }]}>
                Photos live in the albums, not in the group. Leaving stops the
                next one reaching you — it takes nothing away from the albums
                you were in.
              </Text>
            </ScrollView>
          ) : pane === 'chat' ? (
            /*
              The room's conversation, in the room.

              It was a disc in the header that opened a screen of its own, with
              a second header naming the group you had just come from.
              `GroupChat` is that screen's body, lifted out so both places draw
              one conversation — the standalone screen still exists, because
              the list of conversations opens it directly.
            */
            <GroupChat api={api} group={group} t={t} keyboardOffset={HEAD} />
          ) : (
            <ScrollView contentContainerStyle={styles.paneScroll}>
              {/*
                Who is waiting to be let in, above who is already here.

                It used to sit above the archive, where an admin met it on the
                way to the albums. This is the pane about people, so it is the
                pane a request belongs on — and the tab carries the count, the
                way an album's Comments tab carries its unread one, so nobody
                has to open it to find out there is nothing waiting.
              */}
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
              <Text style={[styles.small, styles.gutter, { color: t.dim }]}>
                {group.everyAlbum !== null && group.everyAlbum > 1
                  ? `${group.everyAlbum} of you have been to every one`
                  : plural(group.memberCount, 'person', 'people')}
              </Text>

              <View style={styles.gutter}>
                {group.people.map((person) => {
                  const own = lensFor(person.actorId);
                  return (
                    <Pressable
                      key={person.actorId}
                      /* Only where there is a profile to open. Somebody who has
                         not chosen a handle has no page, and a control that
                         does nothing is worse than a label that never
                         offered. */
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
                      {/* Who runs the room, which is the only thing this list
                          has to say about anybody beyond their name. */}
                      {person.role === 'admin' && (
                        <Text style={[styles.small, { color: t.dim }]}>Runs it</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
      )}

      {more && group.member && (
        <GroupMore
          t={t}
          Button={Button}
          named={group.named}
          // Two people is a conversation, not a room. See `GroupMore`.
          nameable={group.memberCount > 2}
          onName={rename}
          onLeave={leave}
          onClose={() => setMore(false)}
        />
      )}
    </View>
  );
}

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
/**
 * The three panes, and which of them is showing.
 *
 * The album's `Segmented`, in the file that needs it here — a room and an
 * evening are the same kind of object to a reader and a second treatment for
 * "which part of this am I looking at" is how a product comes to have two.
 * Not imported from `App.tsx`, which imports this file: the same reason
 * `GroupTheme` is declared here rather than shared.
 */
export type GroupPane = 'albums' | 'chat' | 'people';

function Tabs({
  pane,
  onPane,
  t,
  waiting,
}: {
  pane: GroupPane;
  onPane: (pane: GroupPane) => void;
  t: GroupTheme;
  /** Join requests, which only an admin ever has. Zero draws nothing. */
  waiting: number;
}) {
  const items: [GroupPane, GlyphName, string][] = [
    ['albums', 'photos', 'Albums'],
    ['chat', 'bubbles', 'Chat'],
    ['people', 'group', 'People'],
  ];
  return (
    <View style={[styles.segmented, { backgroundColor: t.card }]}>
      {items.map(([id, glyph, label]) => {
        const on = pane === id;
        return (
          <Pressable
            key={id}
            onPress={() => onPane(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={
              id === 'people' && waiting > 0 ? `${label}, ${waiting} waiting to join` : label
            }
            style={[styles.segment, on && [styles.segmentOn, { backgroundColor: t.bg }]]}
          >
            <Glyph name={glyph} size={20} color={on ? t.fg : t.dim} />
            {/* The same pip an album's Comments tab carries, about the same
                kind of fact: something is waiting on this tab. */}
            {id === 'people' && waiting > 0 && (
              <Text style={[styles.segmentCount, { color: t.accent }]}>{waiting}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One album on the shelf, drawn the way the profile draws one.
 *
 * Cover, name, and a line of date and count under the picture rather than over
 * it — a scrim block across the bottom of every tile is a grid that reads as
 * captioned stock photography. Two across, because at this width a cover is a
 * photograph and at a third of it it is a swatch.
 *
 * What it adds to the profile's tile is the pip: a group tells you which
 * albums have moved since you last looked, and that is the one thing a room
 * knows that a person's shelf does not.
 */
function AlbumTile({
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
  const when = dateLabel(album.at);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${plural(album.photoCount, 'photo')}${
        album.fresh > 0 ? `, ${album.fresh} new` : ''
      }`}
      style={{ width }}
    >
      <View>
        {album.cover ? (
          <Image
            source={{ uri: album.cover }}
            style={styles.tile}
            contentFit="cover"
            transition={120}
          />
        ) : (
          /* Dashed, which reads as "nothing here" rather than as a very dark
             photograph — the call the profile's own shelf already makes. An
             album with nothing in it yet still belongs here: it is one of the
             things this room has, and leaving it out would make the shelf
             disagree with the count in the head. */
          <View style={[styles.tile, styles.tileEmpty, { borderColor: t.line }]} />
        )}
        {album.fresh > 0 && (
          <View style={[styles.tilePip, { backgroundColor: t.accent, borderColor: t.bg }]} />
        )}
      </View>
      <Text style={[styles.tileName, { color: t.fg }]} numberOfLines={1}>
        {album.name}
      </Text>
      <Text style={[styles.tileMeta, { color: t.dim }]} numberOfLines={1}>
        {album.photoCount === 0
          ? 'Nothing in it yet'
          : when
            ? `${when} · ${album.photoCount}`
            : plural(album.photoCount, 'photo')}
      </Text>
    </Pressable>
  );
}

/**
 * Everything else about the room — which is now two things: naming it, and
 * leaving it.
 *
 * ## Why naming lives here and not on the way in
 *
 * A chat is made out of people and nothing else, so most rooms arrive with no
 * name and are called after whoever is in them. This is the other end of that:
 * the moment a conversation turns out to be a standing thing is weeks after it
 * started, and this is the screen somebody is on when they notice.
 *
 * The field is empty for an unnamed room and holds the name for a named one,
 * and the button says which of the two is about to happen. Clearing it is
 * allowed and puts the room back to being called after its people — a way out
 * of a name somebody regrets, and the reason the column keeps null and `''`
 * apart rather than treating both as "no name".
 *
 * ## Not offered on a conversation with one person
 *
 * `nameable` is false for a room of two. A chat with Jack is called Jack, it
 * is not on any shelf of groups, and naming it would make it one — which is a
 * thing done to the other person rather than with them. The server refuses it
 * too; this is so the control is not there to press. The way to make a group
 * out of a chat is to add somebody, which is a thing both people can see.
 */
function GroupMore({
  t,
  Button,
  named,
  nameable,
  onName,
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
  /** The name as stored, null for a room nobody has named. */
  named: string | null;
  /** False for a conversation with one person. See above. */
  nameable: boolean;
  onName: (name: string) => Promise<void>;
  onLeave: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(named ?? '');
  const [busy, setBusy] = useState(false);

  // Nothing to do when the field says what the room already says. Trimmed on
  // both sides, so adding a space is not a change somebody can submit.
  const changed = draft.trim() !== (named ?? '').trim();

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetShell}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          {nameable && (
            <>
              <Text style={[styles.label, { color: t.fg }]}>
                {named === null ? 'Name this group' : 'Group name'}
              </Text>
              <Text style={[styles.small, { color: t.dim }]}>
                {named === null
                  ? 'It is called after the people in it until you give it one.'
                  : 'Clear it to go back to being called after the people in it.'}
              </Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Sunday roast"
                placeholderTextColor={t.dim}
                maxLength={80}
                returnKeyType="done"
                style={[
                  styles.nameField,
                  { borderColor: t.line, color: t.fg, backgroundColor: t.bg },
                ]}
                accessibilityLabel="Group name"
              />
              <Button
                label={busy ? 'Saving…' : named === null ? 'Name it' : 'Save name'}
                onPress={() => {
                  if (busy || !changed) return;
                  setBusy(true);
                  void onName(draft.trim()).finally(() => {
                    setBusy(false);
                    onClose();
                  });
                }}
                disabled={busy || !changed}
                primary
                t={t}
              />
            </>
          )}

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
  gutter: { paddingHorizontal: 20 },
  centred: { alignItems: 'center', justifyContent: 'center' },

  /*
   * The head, which stays put while the panes change under it.
   *
   * A fixed height for the reason an album's cover has one: the tabs under it
   * must not move when a name runs to two lines, and a row of tabs that
   * shifts is a row somebody mis-taps. `HEAD` is that height and `page` starts
   * exactly there.
   */
  head: { height: HEAD, borderBottomWidth: 1, paddingTop: 60, gap: 14 },
  /* Below the head and filling the rest, so a pane scrolls inside its own
     frame rather than taking the head with it. The album's `page` is the same
     three lines for the same reason. */
  page: { position: 'absolute', top: HEAD, left: 0, right: 0, bottom: 0 },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  /* Inside a 36pt disc, so it needs no line height of its own to sit level. */
  back: { fontSize: 24, lineHeight: 26 },

  /* The tabs, and the one thing this room does that is not looking at it. The
     album's row, restated: there is no stylesheet between the two files. */
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  segmented: { flex: 1, flexDirection: 'row', gap: 4, borderRadius: 10, padding: 3 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 8,
  },
  segmentOn: {},
  segmentCount: { fontSize: 12, fontWeight: '700' },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Room for the floating tab bubble at the foot of every pane. */
  paneScroll: { paddingTop: 4, paddingBottom: 140, gap: 14 },
  doorScroll: { paddingTop: 20, paddingBottom: 140, gap: 18 },

  /* Two across, with gutters rather than hairlines: these tiles are cards,
     not one object. The profile's shelf, in the file that needed the same. */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  /* The profile's tile, number for number: 120 tall at radius 12, the name at
     14 six points under it and the line beneath that at 12.5. Restated rather
     than shared, like every other pair of numbers these screens hold in
     common — there is no stylesheet between two React Native files, and
     `groups-tab.test.ts` is what keeps the two honest. */
  tile: { width: '100%', height: 120, borderRadius: 12, backgroundColor: '#8881' },
  tileEmpty: { borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
  tileName: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  tileMeta: { fontSize: 12.5 },
  /* What has moved since you last looked, which is the one thing a room knows
     that a person's shelf does not. A dot rather than a count: the number is
     precision nobody asked for on a tile this size. */
  tilePip: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },

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

  /* The rule the Albums pane ends on, and the only ruled-off block on it. */
  footnote: { marginTop: 14, paddingTop: 16, borderTopWidth: 1, fontSize: 12.5, lineHeight: 19 },

  /* The one field on this screen. Sized like the album's own name field, on
     the sheet's background rather than its card, so it reads as a hole in the
     panel rather than a second panel on it. */
  nameField: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
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
