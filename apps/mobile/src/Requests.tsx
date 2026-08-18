/**
 * Everything waiting on an answer from you, as one bubble at the top of home.
 *
 * The web's Activity page owns the same three questions — an invitation to an
 * album, a friend request, somebody asking into an album you run — and this is
 * the same object with the same rules, because "two clients, one protocol"
 * has to mean the same thing is being said in both places and not only the
 * same bytes moving.
 *
 * There is no Activity tab here to put it on. That is not a gap this file
 * should fill: three tabs is the whole of the app's navigation, and a fourth
 * added to carry a list that is usually empty would cost a permanent quarter
 * of the tab bar. Home is where somebody looks first and where the count is
 * worth something.
 *
 * Shown at zero as well, greyed and inert. A count that only appears when it
 * is non-zero teaches people to read its absence as news, and absence is also
 * what a failed fetch looks like — on a phone, where the request went out on
 * a train, that is not a rare case.
 *
 * Optimistic in one direction, matching the web: the row goes as soon as the
 * answer is sent, because either answer settles the question. A failure puts
 * it back and says so.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Api, PendingRequest } from './api';
import type { GroupTheme } from './Groups';

/** What the two buttons are called, per kind. */
const ANSWERS: Record<PendingRequest['kind'], { yes: string; no: string }> = {
  invite: { yes: 'Accept', no: 'Decline' },
  friend: { yes: 'Accept', no: 'Decline' },
  // A door being opened onto photographs of an evening. "Accept" is the word
  // for agreeing to something, which is not what this is.
  join: { yes: 'Let in', no: 'Not now' },
};

export function RequestBubble({
  api,
  t,
  /** Bumped by the pull-to-refresh above, so one gesture refreshes both. */
  refreshKey = 0,
  onAnswered,
}: {
  api: Api;
  t: GroupTheme;
  refreshKey?: number;
  onAnswered?: () => void;
}) {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    /*
     * A failure leaves the last good list alone rather than emptying it.
     *
     * Zero is a claim — it is drawn, and it says nothing is waiting. A dropped
     * request on a bad connection must not be able to make that claim.
     */
    void api
      .requests()
      .then((next) => {
        if (live) setRequests(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, refreshKey]);

  const answer = useCallback(
    async (request: PendingRequest, yes: boolean) => {
      setBusy(request.key);
      setError(null);
      const before = requests;
      setRequests((list) => list.filter((r) => r.key !== request.key));
      try {
        await api.answerRequest(request, yes);
        // Accepting an invitation is the only answer that changes what this
        // person can reach, so it is the only one the list above needs to hear
        // about.
        if (yes && request.kind === 'invite') onAnswered?.();
      } catch {
        setRequests(before);
        setError('Could not answer that. Try again in a moment.');
      } finally {
        setBusy(null);
      }
    },
    [api, onAnswered, requests],
  );

  const n = requests.length;
  const none = n === 0;

  return (
    <View style={styles.wrap}>
      <Pressable
        // Nothing behind it at zero, so it is not something to press.
        disabled={none}
        onPress={() => setExpanded((was) => !was)}
        accessibilityRole={none ? 'text' : 'button'}
        accessibilityState={{ expanded: none ? undefined : expanded }}
        style={({ pressed }) => [
          styles.bubble,
          {
            backgroundColor: none ? t.line : withAlpha(t.accent, 0.14),
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <View style={[styles.count, { backgroundColor: none ? t.dim : t.accent }]}>
          <Text style={[styles.countText, { color: t.onAccent }]}>{n}</Text>
        </View>
        <Text style={[styles.label, { color: none ? t.dim : t.accent }]}>
          {/*
            "Invites", the same word the web bubble uses. The old label
            described the product's job rather than the person's: it is a queue
            from the software's point of view and an invitation from theirs.
            Somebody asking into an album you run stretches the word slightly,
            and that is the right way round — the rows underneath say exactly
            who wants what.
          */}
          {n === 1 ? 'invite' : 'invites'}
        </Text>
        {!none && (
          <Text style={[styles.chevron, { color: t.accent }]}>
            {expanded ? '⌃' : '⌄'}
          </Text>
        )}
      </Pressable>

      {expanded && !none && (
        <View style={styles.list}>
          {error && <Text style={[styles.error, { color: t.dim }]}>{error}</Text>}
          {requests.map((request) => (
            <View
              key={request.key}
              style={[styles.item, { backgroundColor: t.card, borderColor: t.line }]}
            >
              <View style={styles.what}>
                <Text style={[styles.title, { color: t.fg }]}>{request.title}</Text>
                <Text style={[styles.detail, { color: t.dim }]}>{request.detail}</Text>
              </View>
              {/*
                Stacked under the line rather than beside it. A phone is not
                wide enough for a name, a sentence and two buttons on one row,
                and the version that fits makes both buttons small enough to
                mis-tap — which on this list means letting somebody into an
                album you meant to refuse.
              */}
              <View style={styles.answers}>
                <Pressable
                  disabled={busy === request.key}
                  onPress={() => void answer(request, true)}
                  style={({ pressed }) => [
                    styles.answer,
                    {
                      backgroundColor: t.accent,
                      borderColor: t.accent,
                      opacity: busy === request.key ? 0.5 : pressed ? 0.7 : 1,
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
                  style={({ pressed }) => [
                    styles.answer,
                    {
                      borderColor: t.line,
                      opacity: busy === request.key ? 0.5 : pressed ? 0.7 : 1,
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
    </View>
  );
}

/**
 * The accent at low opacity, as a solid colour.
 *
 * Same trick as the card scrim, for the same reason: a translucent fill over a
 * scrolling list picks up whatever passes under it, and this pill sits above
 * photographs.
 */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 16,
    borderRadius: 999,
  },
  count: {
    minWidth: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { flex: 1, fontSize: 15, fontWeight: '600' },
  chevron: { fontSize: 16, fontWeight: '700' },
  list: { gap: 8 },
  error: { fontSize: 13, lineHeight: 18 },
  item: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  what: { gap: 2 },
  title: { fontSize: 16, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 19 },
  answers: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  answer: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16 },
  answerText: { fontSize: 15, fontWeight: '600' },
});
