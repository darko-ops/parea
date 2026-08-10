/**
 * Geotag coverage probe — see ../README.md.
 *
 * Measures whether the dominant-location-cluster filter in docs/design.md §7.2
 * would actually work on this phone's camera roll. Reads metadata only, uploads
 * nothing, and shows the exact payload before anything is shared.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';

import {
  assess,
  sessionise,
  summarise,
  verdict,
  type SessionResult,
} from './src/analysis';
import { scan, type ScanProgress } from './src/scan';
import { buildReport, caveats, shareText, type Report } from './src/report';

const MONTHS_BACK = 12;

const VERDICT_COPY = {
  viable: {
    title: 'Auto-selection is viable',
    body: 'The location filter is doing real work and most events get a tight suggestion.',
  },
  mixed: {
    title: 'Mixed',
    body: 'Some events get a suggestion, many degrade. The fallback grid has to be genuinely good.',
  },
  'does-not-hold': {
    title: 'Does not hold on this library',
    body: 'Most events would degrade to a plain grid. Check the caveats before concluding anything.',
  },
} as const;

export default function App() {
  const dark = useColorScheme() === 'dark';
  const t = useMemo(() => theme(dark), [dark]);

  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [sessions, setSessions] = useState<SessionResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setError(null);
    setReport(null);
    setCopied(false);
    try {
      const result = await scan(MONTHS_BACK, (items) => sessionise(items), setProgress);
      const assessed = result.candidates.length
        ? sessionise(result.candidates).map((s) => assess(s))
        : [];
      const summary = summarise(assessed);
      setSessions(assessed);
      setReport(buildReport(result, assessed, summary, MONTHS_BACK));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }, []);

  const notes = report ? caveats(report) : [];
  const running = progress !== null;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.h1, { color: t.fg }]}>Geotag coverage probe</Text>
        <Text style={[styles.body, { color: t.dim }]}>
          Checks whether your camera roll has enough location data for an app to
          find your photos from an event automatically.
        </Text>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.cardTitle, { color: t.fg }]}>What this does</Text>
          <Text style={[styles.body, { color: t.dim }]}>
            Reads capture times and locations from the last {MONTHS_BACK} months.
            It does not read, copy, or upload any photo. Nothing leaves your phone
            unless you tap Share, and you can read the exact text first.
          </Text>
        </View>

        {!report && !running && (
          <Button label="Scan my library" onPress={run} t={t} primary />
        )}

        {running && (
          <View style={styles.progress}>
            <ActivityIndicator color={t.accent} />
            <Text style={[styles.body, { color: t.dim }]}>
              {progress.phase === 'permission' && 'Waiting for permission…'}
              {progress.phase === 'listing' && 'Reading capture times…'}
              {progress.phase === 'locating' &&
                `Reading locations — ${progress.done} of ${progress.total}`}
              {progress.phase === 'done' && 'Analysing…'}
            </Text>
          </View>
        )}

        {error && (
          <View style={[styles.card, { backgroundColor: t.warnBg, borderColor: t.warnLine }]}>
            <Text style={[styles.body, { color: t.fg }]}>{error}</Text>
          </View>
        )}

        {report && (
          <>
            <Headline report={report} t={t} />

            {notes.length > 0 && (
              <View style={[styles.card, { backgroundColor: t.warnBg, borderColor: t.warnLine }]}>
                <Text style={[styles.cardTitle, { color: t.fg }]}>Read this first</Text>
                {notes.map((n, i) => (
                  <Text key={i} style={[styles.body, { color: t.fg }]}>
                    • {n}
                  </Text>
                ))}
              </View>
            )}

            <SessionTable sessions={sessions} t={t} />

            <Button
              label={showPayload ? 'Hide what gets shared' : 'Show exactly what gets shared'}
              onPress={() => setShowPayload((v) => !v)}
              t={t}
            />
            {showPayload && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                <Text style={[styles.mono, { color: t.dim }]}>
                  {JSON.stringify(report, null, 2)}
                </Text>
              </View>
            )}

            <Button
              label="Share result"
              primary
              t={t}
              onPress={() => Share.share({ message: shareText(report) })}
            />
            <Button
              label={copied ? 'Copied' : 'Copy to clipboard'}
              t={t}
              onPress={async () => {
                await Clipboard.setStringAsync(shareText(report));
                setCopied(true);
              }}
            />
            <Button label="Scan again" onPress={run} t={t} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Headline({ report, t }: { report: Report; t: Theme }) {
  const s = report.summary;
  const copy = VERDICT_COPY[verdict(s.confidentRate)];
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.big, { color: t.accent }]}>
        {s.confidentEvents}/{s.events}
      </Text>
      <Text style={[styles.body, { color: t.dim }]}>
        events would get a confident pre-selection
      </Text>
      <Text style={[styles.cardTitle, { color: t.fg, marginTop: 14 }]}>{copy.title}</Text>
      <Text style={[styles.body, { color: t.dim }]}>{copy.body}</Text>
      {s.confidentEvents > 0 && (
        <Text style={[styles.body, { color: t.dim, marginTop: 10 }]}>
          Within those, a time window alone would tick {s.windowWouldTick} photos;
          adding location ticks {s.locationTicks}, removing {s.removedByLocation}.
        </Text>
      )}
      <Text style={[styles.small, { color: t.dim }]}>
        {report.totalImagesInRange} photos over {report.monthsScanned} months ·{' '}
        {report.locationLookups} locations read
      </Text>
    </View>
  );
}

function SessionTable({ sessions, t }: { sessions: SessionResult[]; t: Theme }) {
  if (!sessions.length) return null;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.cardTitle, { color: t.fg }]}>Candidate events</Text>
      <View style={styles.row}>
        {['when', 'n', 'gps', 'clust', 'result'].map((h, i) => (
          <Text
            key={h}
            style={[styles.cell, styles.mono, { color: t.dim, flex: i === 4 ? 2 : 1 }]}
          >
            {h}
          </Text>
        ))}
      </View>
      {sessions.map((s, i) => (
        <View key={i} style={[styles.row, { borderTopColor: t.line, borderTopWidth: 1 }]}>
          <Text style={[styles.cell, styles.mono, { color: t.fg }]}>
            {days[s.weekday]} {String(s.startHour).padStart(2, '0')}h
          </Text>
          <Text style={[styles.cell, styles.mono, { color: t.fg }]}>{s.photosInWindow}</Text>
          <Text style={[styles.cell, styles.mono, { color: t.fg }]}>
            {Math.round(s.geoRate * 100)}%
          </Text>
          <Text style={[styles.cell, styles.mono, { color: t.fg }]}>
            {Math.round(s.clusterShareOfGeotagged * 100)}%
          </Text>
          <Text
            style={[
              styles.cell,
              styles.mono,
              { flex: 2, color: s.wouldPreselect ? t.accent : t.dim },
            ]}
          >
            {s.wouldPreselect ? `tick ${s.preselectCount}` : 'tick nothing'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Button({
  label,
  onPress,
  t,
  primary,
}: {
  label: string;
  onPress: () => void;
  t: Theme;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? t.accent : 'transparent',
          borderColor: primary ? t.accent : t.line,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? t.onAccent : t.fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

type Theme = ReturnType<typeof theme>;

function theme(dark: boolean) {
  return dark
    ? {
        bg: '#0d0f12', card: '#171a1f', line: '#272b33', fg: '#f2f4f7',
        dim: '#9aa3af', accent: '#6ea8fe', onAccent: '#0d0f12',
        warnBg: '#2a1f14', warnLine: '#4a3720',
      }
    : {
        bg: '#f7f8fa', card: '#ffffff', line: '#e3e6ea', fg: '#14171c',
        dim: '#5b6472', accent: '#1a5fd0', onAccent: '#ffffff',
        warnBg: '#fff6e6', warnLine: '#f0d9a8',
      };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingTop: 72, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700', marginBottom: 2 },
  big: { fontSize: 44, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 12, marginTop: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  button: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  progress: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  row: { flexDirection: 'row', paddingVertical: 8 },
  cell: { flex: 1, fontSize: 12 },
  mono: { fontFamily: 'Courier' },
});
