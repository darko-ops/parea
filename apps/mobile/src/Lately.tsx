/**
 * Lately — answer, then read.
 *
 * The web's Activity page, at phone metrics. Two halves in that order, and the
 * order is urgency rather than time: the top is what somebody is on the other
 * end waiting for, as cards you can answer without opening anything; below it
 * is what has already happened, which is a list to read and not a list to work
 * through.
 *
 * ## Why this is a screen and not a fourth tab
 *
 * `Requests.tsx` argued the opposite case and was right at the time: three tabs
 * is the whole of this app's navigation, and a fourth carrying a list that is
 * usually empty would cost a permanent quarter of the tab bar. Nothing about
 * that has changed. What has changed is that the list stopped being only
 * requests — the feed underneath is most of it, and a feed has nowhere to live
 * in a bubble.
 *
 * So it is a door in the Groups tab's heading row instead: a disc beside the
 * one already there, carrying an envelope and the number waiting. It costs
 * nothing when there is nothing, and the badge is the whole notification
 * surface — no tab, no dot on a tab, no row at the top of a list somebody is
 * scrolling past.
 *
 * ## Worded on the server
 *
 * Every relative time and every day-heading arrives composed — see `when.ts` on
 * the web. A device's clock is a setting, and a phone in the wrong timezone
 * would draw a feed whose headings disagree with the one the same person saw in
 * a browser ten minutes ago. The runs are grouped here, because a run has to be
 * recomputed as rows are answered and a heading handed down as a row would sit
 * over nothing.
 *
 * ## What is deliberately not here
 *
 * **Hiding a line.** The web has a `···` on each row that writes to
 * `hidden_activity`. It is the right feature and it is not this screen's first
 * problem: a phone's version of it is a swipe or a long press, both of which
 * are gestures to design rather than a menu to port. The rows are links until
 * then.
 *
 * **Per-item read state.** There is none to have — `actor.invites_seen_at` is
 * one boundary for the whole list, which is what `unread` is read against. That
 * is a decision made in `activity.ts`, not one this screen could revisit.
 */

import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ActivityRow, Api, PendingRequest } from './api';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { ANSWERS } from './answers';
import { Back, RoundButton } from './RoundButton';
import { Waiting } from './Waiting';

/**
 * A day's worth of rows, under the heading the server worded.
 *
 * Regrouped from the list on every render rather than handed down as rows,
 * which is the same call the web makes: answering the only line of a day has to
 * take that day's heading with it.
 *
 * Keyed by the run rather than by the word, so a mis-sorted list draws two
 * headings with the same word — visibly wrong, which is what a bug should be —
 * instead of silently folding distant days together.
 */
function byDay(rows: ActivityRow[]): { bucket: string; rows: ActivityRow[] }[] {
  const days: { bucket: string; rows: ActivityRow[] }[] = [];
  for (const row of rows) {
    const last = days[days.length - 1];
    if (last && last.bucket === row.bucket) last.rows.push(row);
    else days.push({ bucket: row.bucket, rows: [row] });
  }
  return days;
}

/** A person's face or an album's cover, else the letter on its lens. */
function Tile({
  image,
  name,
  keyed,
  size,
  radius,
}: {
  image: string | null;
  name: string;
  keyed: string;
  size: number;
  radius: number;
}) {
  const lens = lensFor(keyed);
  if (image) {
    return (
      <ExpoImage
        source={{ uri: image }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        transition={120}
      />
    );
  }
  return (
    <View
      style={[
        styles.centre,
        { width: size, height: size, borderRadius: radius, backgroundColor: lens.fill },
      ]}
    >
      <Text style={{ fontSize: size * 0.38, fontWeight: '600', color: lens.ink }}>
        {initialOf(name)}
      </Text>
    </View>
  );
}

export function Lately({
  api,
  t,
  onBack,
  onAnswered,
  onOpenEvent,
  onOpenPerson,
}: {
  api: Api;
  t: GroupTheme;
  onBack: () => void;
  /**
   * Something was answered, so the lists behind this are stale.
   *
   * An accepted invitation is an album on the home screen and possibly a group
   * in the tab underneath — neither of which this screen can see, and both of
   * which would otherwise stay wrong until something else happened to reload
   * them.
   */
  onAnswered: () => void;
  onOpenEvent: (eventId: string) => void;
  onOpenPerson: (handle: string) => void;
}) {
  const [waiting, setWaiting] = useState<PendingRequest[]>([]);
  const [items, setItems] = useState<ActivityRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const lately = await api.activity();
      setWaiting(lately.waiting);
      setItems(lately.items);
      setError(null);
    } catch {
      // Kept separate from an empty list, which is a real and common answer.
      // "Nothing has happened" and "we could not find out" are different
      // sentences and only one of them is worth showing a retry under.
      setItems([]);
      setError('Could not load this. Pull to try again.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Optimistic in one direction, as the bubble on Home is.
   *
   * The card goes the moment the answer is sent, because either answer settles
   * the question — there is no state in which it should still be sitting there.
   * A failure puts it back and says so, rather than leaving somebody looking at
   * a list that did not change.
   */
  const answer = useCallback(
    async (request: PendingRequest, yes: boolean) => {
      setBusy(request.key);
      const before = waiting;
      setWaiting((list) => list.filter((r) => r.key !== request.key));
      try {
        await api.answerRequest(request, yes);
        onAnswered();
        // Not the whole screen: answering writes a line into the feed below —
        // "you can see Barcelona now" — and the point of reloading is to show
        // it, which is also how somebody sees that the answer took.
        await load();
      } catch {
        setWaiting(before);
        setError('That did not go through. Try again in a moment.');
      } finally {
        setBusy(null);
      }
    },
    [api, load, onAnswered, waiting],
  );

  /**
   * Where a line goes when it is pressed.
   *
   * The server hands down a web path — `/event/<id>`, `/u/<handle>` — because
   * the web is the client it was written for, and translating it here is
   * cheaper than teaching `activity.ts` about a second client's navigation.
   *
   * An href this cannot map to a screen is a row that does not respond, rather
   * than one that opens a browser. Leaving the app to read a notification about
   * the app is the worst answer available, and `/friends` — the fallback for
   * somebody with no handle — is the one that would do it.
   */
  const follow = useCallback(
    (row: ActivityRow) => {
      const event = row.href?.match(/^\/event\/([0-9a-f-]{36})$/i);
      if (event) return onOpenEvent(event[1]!);
      const person = row.href?.match(/^\/u\/([^/]+)$/);
      if (person) return onOpenPerson(decodeURIComponent(person[1]!));
    },
    [onOpenEvent, onOpenPerson],
  );

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* The same disc, in the same corner, at the same height as the album's
          — one way back, wherever you are. */}
      <RoundButton t={t} onPress={onBack} accessibilityLabel="Back" style={styles.back}>
        <Back color={t.fg} />
      </RoundButton>

      <ScrollView
        contentContainerStyle={[styles.scroll, items === null && styles.filling]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.dim}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={[styles.h1, { color: t.fg }]}>Lately</Text>

        {items === null ? (
          <View style={styles.centreFill}>
            <Waiting size={36} />
          </View>
        ) : (
          <>
            {error && <Text style={[styles.error, { color: t.dim }]}>{error}</Text>}

            {waiting.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: t.fg }]}>Waiting on you</Text>
                  <Text style={[styles.sectionCount, { color: t.dim }]}>{waiting.length}</Text>
                </View>

                {waiting.map((request) => (
                  <View
                    key={request.key}
                    style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}
                  >
                    <View style={styles.cardTop}>
                      <Tile
                        image={request.image ?? null}
                        name={request.title}
                        keyed={request.key}
                        size={44}
                        radius={11}
                      />
                      <View style={styles.cardWords}>
                        <Text style={[styles.cardTitle, { color: t.fg }]} numberOfLines={1}>
                          {request.title}
                        </Text>
                        <Text style={[styles.cardDetail, { color: t.dim }]}>
                          {request.detail}
                          {request.when ? ` · ${request.when}` : ''}
                        </Text>
                      </View>
                    </View>

                    {/*
                      Both answers, both the same size.

                      Declining is not a lesser action and a screen that draws
                      it as one is a screen nudging somebody into a room they
                      did not want to be in. The affirmative is filled because
                      it is the common answer, not because it is the right one.
                    */}
                    <View style={styles.cardButtons}>
                      <Pressable
                        disabled={busy === request.key}
                        onPress={() => void answer(request, true)}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.answer,
                          {
                            backgroundColor: t.accent,
                            opacity: busy === request.key ? 0.5 : pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.answerText, { color: t.onAccent }]}>
                          {ANSWERS[request.kind].yes}
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={busy === request.key}
                        onPress={() => void answer(request, false)}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.answer,
                          styles.answerPlain,
                          {
                            borderColor: t.line,
                            opacity: busy === request.key ? 0.5 : pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.answerText, { color: t.fg }]}>
                          {ANSWERS[request.kind].no}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {byDay(items).map((day) => (
              <View key={day.rows[0]!.id} style={styles.day}>
                <View style={styles.dayHead}>
                  <Text style={[styles.dayWord, { color: t.dim }]}>
                    {day.bucket.toUpperCase()}
                  </Text>
                  <View style={[styles.rule, { backgroundColor: t.line }]} />
                </View>

                {day.rows.map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => follow(row)}
                    accessibilityRole={row.href ? 'button' : 'text'}
                    style={({ pressed }) => [
                      styles.row,
                      // Unread rows are on the card colour and older ones are
                      // not, which is the whole of the new/old distinction —
                      // there is one boundary for the list, so a dot per row
                      // would be the same fact drawn fifty times.
                      row.unread && { backgroundColor: t.card },
                      pressed && row.href ? { opacity: 0.7 } : null,
                    ]}
                  >
                    <Tile
                      image={row.image}
                      name={row.who}
                      keyed={row.id}
                      size={34}
                      radius={9}
                    />
                    <Text style={[styles.rowText, { color: t.fg }]}>
                      <Text style={styles.rowWho}>{row.who} </Text>
                      {row.what}
                    </Text>

                    {/*
                      The photographs the line is about, on the one kind that
                      has any. A sentence about pictures that shows you none of
                      them, inside a product whose subject is photographs, is
                      a notification you have to open to evaluate.
                    */}
                    {row.images.length > 0 && (
                      <View style={styles.rowShots}>
                        {row.images.slice(0, 2).map((src) => (
                          <ExpoImage
                            key={src}
                            source={{ uri: src }}
                            style={styles.rowShot}
                            contentFit="cover"
                            transition={120}
                          />
                        ))}
                      </View>
                    )}

                    <Text style={[styles.rowWhen, { color: t.dim }]}>{row.when}</Text>
                  </Pressable>
                ))}
              </View>
            ))}

            {waiting.length === 0 && items.length === 0 && !error && (
              <View style={styles.nothing}>
                <Glyph name="envelope" size={26} color={t.dim} />
                <Text style={[styles.nothingText, { color: t.dim }]}>
                  Nothing lately. When somebody asks you into an album, adds
                  photographs to one you are in, or answers something you asked,
                  it turns up here.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* The album's own back button, at the album's own inset. */
  back: { position: 'absolute', top: 52, left: 16, zIndex: 3 },
  scroll: { paddingTop: 100, paddingHorizontal: 20, paddingBottom: 48 },
  /* Paired with `flexGrow: 1` so the spinner can centre in the scroll view
     rather than sitting under the title. */
  filling: { flexGrow: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  centreFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  error: { fontSize: 13, lineHeight: 19, paddingTop: 14 },

  section: { paddingTop: 22, gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.01 },
  sectionCount: { fontSize: 12.5 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  cardTop: { flexDirection: 'row', gap: 14 },
  cardWords: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 15.5, fontWeight: '600' },
  cardDetail: { fontSize: 13, lineHeight: 19 },
  cardButtons: { flexDirection: 'row', gap: 8 },
  answer: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  answerPlain: { borderWidth: 1 },
  answerText: { fontSize: 13.5, fontWeight: '600' },

  day: { paddingTop: 22 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 },
  dayWord: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  rule: { flex: 1, height: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  rowText: { flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 21 },
  rowWho: { fontWeight: '600' },
  rowShots: { flexDirection: 'row', gap: 4 },
  rowShot: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#8883' },
  rowWhen: { fontSize: 12.5 },

  nothing: { paddingTop: 60, alignItems: 'center', gap: 12 },
  nothingText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 300 },
});
