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

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Api, EventListing, Person, ProfileAlbum, SharedEvent, Standing } from './api';
import type { GroupTheme } from './Groups';

/** What we call somebody: their name if they gave one, else the handle. */
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
        <ActivityIndicator color={t.dim} />
      </View>
    );
  }

  const name = nameOf(person);
  const initial = name.replace('@', '').slice(0, 1).toUpperCase();

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onBack}>
        <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
      </Pressable>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <View style={styles.who}>
          {person.avatar ? (
            <Image source={{ uri: person.avatar }} style={styles.face} />
          ) : (
            /* A letter, the same fallback the web uses. An avatar URL is
               presigned and expires, and a broken image frame is worse than
               never having drawn one. */
            <View style={[styles.face, styles.faceBlank, { backgroundColor: t.line }]}>
              <Text style={[styles.label, { color: t.dim }]}>{initial}</Text>
            </View>
          )}
          <View style={styles.whoText}>
            <Text style={[styles.h1, { color: t.fg }]}>{name}</Text>
            {/* The handle under the name, always: it is the durable one, and
                the name above it is whatever they last chose to show. */}
            <Text style={[styles.small, { color: t.dim }]}>@{person.handle}</Text>
          </View>
        </View>

        {standing === 'self' && (
          <Text style={[styles.body, { color: t.dim }]}>This is you.</Text>
        )}
        {standing === 'friends' && (
          <Text style={[styles.body, { color: t.dim }]}>Friends.</Text>
        )}
        {/*
          "Asked" is what a refusal says too. `/api/friends` answers a repeat
          ask with the status it already holds, so a no is said once rather
          than becoming something to press past — and announcing the decline
          every time this screen opened would be the product saying it for
          them, over and over.
        */}
        {standing === 'asked' && (
          <Text style={[styles.body, { color: t.dim }]}>Asked.</Text>
        )}
        {standing === 'none' && (
          <Button label="Add friend" onPress={ask} t={t} primary disabled={busy} />
        )}
        {standing === 'asking' && (
          <View style={styles.answerRow}>
            <Text style={[styles.body, { color: t.dim, flex: 1 }]}>
              {name} asked to be friends.
            </Text>
            <Button label="Accept" onPress={() => void answer(true)} t={t} primary disabled={busy} />
            <Button label="Decline" onPress={() => void answer(false)} t={t} disabled={busy} />
          </View>
        )}
        {error && <Text style={[styles.small, { color: t.dim }]}>{error}</Text>}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Events</Text>
        {shared.length === 0 ? (
          /*
           * Two ways of having none, and they are different sentences.
           *
           * A friend with nothing shared is told it is not there *yet*, which
           * is a fact about the two of you and likely to change. Anybody else
           * used to be told the account was private — the honest answer while
           * this screen listed nothing a stranger was not already in. Their
           * albums are listed below now, so that sentence would contradict the
           * list under it, and what is left is the plain one.
           */
          <Text style={[styles.body, { color: t.dim }]}>
            {standing === 'friends' ? 'No Events Available Yet' : 'Nothing here yet'}
          </Text>
        ) : (
          shared.map((event) => {
            const mine = events.find((e) => e.id === event.id);
            return (
              <Pressable
                key={event.id}
                style={styles.eventRow}
                disabled={!mine}
                onPress={() => mine && onOpenEvent(mine)}
              >
                {event.thumb ? (
                  <Image source={{ uri: event.thumb }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.faceBlank, { backgroundColor: t.line }]}>
                    <Text style={[styles.small, { color: t.dim }]}>
                      {event.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.eventText}>
                  <Text style={[styles.body, { color: mine ? t.accent : t.fg }]}>
                    {event.name}
                  </Text>
                  {event.caption && (
                    <Text style={[styles.small, { color: t.dim }]}>{event.caption}</Text>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      {albums.length > 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.label, { color: t.fg }]}>
            {shared.length > 0 ? 'Their other albums' : 'Albums'}
          </Text>
          {albums.map((album) => {
            const status = asked[album.id];
            return (
              <View key={album.id} style={styles.eventRow}>
                {album.thumb ? (
                  <Image source={{ uri: album.thumb }} style={styles.thumb} />
                ) : (
                  /*
                    A locked album has no thumbnail to draw, and it is not a
                    picture that failed: an empty square, which is what is
                    actually being said. The letter stands in for an unlocked
                    one that simply has no cover yet.
                  */
                  <View style={[styles.thumb, styles.faceBlank, { backgroundColor: t.line }]}>
                    <Text style={[styles.small, { color: t.dim }]}>
                      {album.locked ? '' : album.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.eventText}>
                  <Text style={[styles.body, { color: t.fg }]}>{album.name}</Text>
                  <Text style={[styles.small, { color: t.dim }]}>
                    {album.locked
                      ? 'Private'
                      : album.photoCount === null || album.photoCount === 0
                        ? 'No photos yet'
                        : `${album.photoCount} ${album.photoCount === 1 ? 'photo' : 'photos'}`}
                  </Text>
                </View>
                {album.locked &&
                  (status ? (
                    <Text style={[styles.small, { color: t.dim }]}>
                      {status === 'approved' ? 'Let in' : 'Asked'}
                    </Text>
                  ) : (
                    <Button
                      label="Ask to join"
                      onPress={() => void askToJoin(album)}
                      t={t}
                      disabled={busy}
                    />
                  ))}
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
  scroll: { padding: 20, paddingTop: 72, gap: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  whoText: { flex: 1, gap: 2 },
  face: { width: 64, height: 64, borderRadius: 32 },
  faceBlank: { alignItems: 'center', justifyContent: 'center' },
  answerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  eventText: { flex: 1, gap: 2 },
  thumb: { width: 44, height: 44, borderRadius: 10 },
});
