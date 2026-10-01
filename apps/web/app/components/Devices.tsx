'use client';

/**
 * Where you are signed in, and what can sign you in — design §3.
 *
 * Two lists on one screen, because they are two answers to one question:
 * *what can get into this account?* A session is a device that is already in;
 * a passkey is a device that can let itself in whenever it likes. Splitting
 * them across two screens would mean somebody who revoked every session still
 * had a key they never saw.
 *
 * ## Every row can be ended, including the one being read
 *
 * The current device is marked rather than exempted. A list headed "where you
 * are signed in" that quietly omits the device in your hand is a list that
 * cannot be checked against reality — and the button on that row is just Sign
 * out, arrived at from a different direction.
 */

import { ago } from '@parea/cards';
import { useCallback, useEffect, useState } from 'react';

import { addPasskey, CANCELLED, passkeysAvailable } from './passkey';

type Device = {
  id: string;
  label: string;
  kind: 'browser' | 'ios' | 'android';
  method: 'guest' | 'code' | 'passkey';
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
  /** Sessions under this one label — one laptop collects several. */
  count: number;
};

/** A sign-out waiting on a fresh sign-in. */
type Pending = { kind: 'one'; device: Device } | { kind: 'others' };

type Passkey = {
  id: string;
  label: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * How somebody got in, in words.
 *
 * `guest` is the awkward one and it is worth saying rather than hiding: it is a
 * browser that was contributing before it signed in, folded into the account by
 * a later sign-in elsewhere. It can act as this person, so it is on the list —
 * and the honest description is that nothing recorded a sign-in for it.
 */
function howIn(method: Device['method']): string {
  if (method === 'passkey') return 'signed in with a passkey';
  if (method === 'code') return 'signed in with a code';
  return 'added photos before signing in';
}

export function Devices({ onDone }: { onDone: () => void }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [manageable, setManageable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Where a code goes when a sign-out needs a fresh sign-in. */
  const [email, setEmail] = useState<string | null>(null);

  /*
   * One clock for every "2 hours ago" on the page.
   *
   * `ago` takes the current time rather than reading it, so that a list of
   * twelve rows is twelve comparisons against one instant instead of twelve
   * slightly different ones. Set on mount for the usual reason: rendering
   * `new Date()` makes the server's HTML and the client's disagree.
   */
  const [now, setNow] = useState<Date | null>(null);
  /*
   * Whether this browser can make a passkey, decided after mount.
   *
   * `passkeysAvailable` reads `window`, which does not exist while this renders
   * on the server — calling it during render would produce markup the client
   * disagrees with. Null draws no button, which is the right first frame either
   * way.
   */
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    setNow(new Date());
    setCanPasskey(passkeysAvailable());
  }, []);

  const load = useCallback(async () => {
    const [sessions, keys, me] = await Promise.all([
      fetch('/api/account/devices').then((r) => r.json()).catch(() => ({ devices: [] })),
      fetch('/api/account/passkeys').then((r) => r.json()).catch(() => ({ passkeys: [] })),
      fetch('/api/account/session').then((r) => r.json()).catch(() => ({ account: null })),
    ]);
    setEmail(me.account?.email ?? null);
    setDevices(sessions.devices ?? []);
    setManageable(sessions.manageable !== false);
    setPasskeys(keys.passkeys ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * A sign-out the server sent back for a fresh sign-in, kept so it can run
   * again once the person has proved it is them.
   *
   * Ending another device needs a sign-in within the hour (see the routes).
   * This used to answer with a sentence telling the person to sign out and
   * back in — leave the page, lose the list, and come back to find the row
   * still there. Now the proof is asked for here, by a code to the address on
   * the account, and the sign-out they pressed finishes on its own.
   *
   * A code and not a passkey: a passkey picker offers every account's keys,
   * and choosing somebody else's would sign this browser in as them.
   */
  const [pending, setPending] = useState<Pending | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');

  const run = useCallback(
    async (action: Pending) => {
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch(
          action.kind === 'one' ? `/api/account/devices/${action.device.id}` : '/api/account/devices',
          { method: 'DELETE' },
        );
        if (res.status === 403) {
          setPending(action);
          return;
        }
        setPending(null);

        if (action.kind === 'others') {
          if (!res.ok) {
            setNote('Could not sign the others out. Try again in a moment.');
            return;
          }
          const { ended } = (await res.json().catch(() => ({ ended: 0 }))) as { ended: number };
          // Gone from the list at once, not after a round trip: the list
          // changing is how somebody sees the button worked.
          setDevices((rows) => rows?.filter((row) => row.current).map((row) => ({ ...row, count: 1 })) ?? rows);
          setNote(
            ended === 0
              ? 'Nothing else was signed in.'
              : `${ended} ${ended === 1 ? 'device was' : 'devices were'} signed out.`,
          );
          await load();
          return;
        }

        const { device } = action;
        /*
         * Signing out the device you are holding is a full page load, for the
         * reason the Sign out button gives: everything on this site is rendered
         * for the actor in the cookie, and re-fetching one list would leave
         * every other part of the page correct for somebody who is no longer
         * here.
         */
        if (device.current) {
          window.location.href = '/';
          return;
        }
        // A 404 is a row something else already ended, which is the outcome
        // asked for; anything else failing leaves the row where it was.
        if (!res.ok && res.status !== 404) {
          setNote(`Could not sign out ${device.label}. Try again in a moment.`);
          return;
        }
        setDevices((rows) => rows?.filter((row) => row.id !== device.id) ?? rows);
        setNote(`${device.label} was signed out.`);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const endOne = useCallback(
    (device: Device) => {
      const message = device.current
        ? 'Sign out of this device? You will need to sign in again here.'
        : device.count > 1
          ? `Sign out of ${device.label}? All ${device.count} sign-ins on it end.`
          : `Sign out of ${device.label}? It will need to sign in again.`;
      if (!confirm(message)) return;
      void run({ kind: 'one', device });
    },
    [run],
  );

  const endOthers = useCallback(() => {
    if (!confirm('Sign out everywhere except this device?')) return;
    void run({ kind: 'others' });
  }, [run]);

  const sendCode = useCallback(async () => {
    if (!email) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/account/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setNote(
          res.status === 429
            ? 'Too many codes asked for from here. Try again in an hour.'
            : 'Could not send a code. Try again in a moment.',
        );
        return;
      }
      setCodeSent(true);
    } finally {
      setBusy(false);
    }
  }, [email]);

  const confirmCode = useCallback(async () => {
    if (!email || !pending) return;
    setBusy(true);
    setNote(null);
    try {
      // The same sign-in the sign-in screen does. On a browser already signed
      // in it keeps this session and restarts its clock — see `adoptSession`.
      const res = await fetch('/api/account/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: code.trim() }),
      });
      if (!res.ok) {
        setNote(
          res.status === 429
            ? 'Too many tries from here. Wait an hour, then use the code you have.'
            : 'That code did not work. Codes expire after ten minutes.',
        );
        return;
      }
    } finally {
      setBusy(false);
    }
    setCodeSent(false);
    setCode('');
    await run(pending);
  }, [code, email, pending, run]);

  const cancelPending = useCallback(() => {
    setPending(null);
    setCodeSent(false);
    setCode('');
  }, []);

  const add = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await addPasskey();
      if (!result.ok) {
        if (result.message !== CANCELLED) setNote(result.message as string);
        return;
      }
      await load();
      setNote('Passkey added. This device can sign you in now.');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const removeKey = useCallback(
    async (passkey: Passkey) => {
      if (!confirm(`Remove the passkey on ${passkey.label ?? 'this device'}?`)) return;
      setBusy(true);
      try {
        await fetch(`/api/account/passkeys/${passkey.id}`, { method: 'DELETE' });
        await load();
        setNote('Passkey removed.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  // Counted in sessions, not rows: the current row can stand for siblings that
  // only "everywhere else" reaches.
  const others = (devices ?? []).reduce(
    (sum, device) => sum + device.count - (device.current ? 1 : 0),
    0,
  );

  return (
    <>
      <section className="panel">
        <h2>Where you are signed in</h2>
        <p className="muted">
          Every browser and app holding your account. Sign one out if you do not
          recognise it, or if you have lent it to somebody.
        </p>

        {pending && (
          <div className="device-confirm">
            <p className="device-name">Confirm it is you</p>
            <p className="device-detail">
              {pending.kind === 'one'
                ? `Signing out ${pending.device.label}`
                : 'Signing out everywhere else'}{' '}
              needs a sign-in from the last hour.{' '}
              {codeSent
                ? `Enter the code sent to ${email}.`
                : email
                  ? `We will email a code to ${email}.`
                  : 'Sign out, then back in with a code.'}
            </p>
            {codeSent ? (
              <div className="row">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim()) void confirmCode();
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Code"
                  autoFocus
                />
                <button onClick={confirmCode} disabled={busy || !code.trim()}>
                  {busy ? 'Working…' : 'Confirm and sign out'}
                </button>
              </div>
            ) : (
              email && (
                <div className="row">
                  <button onClick={sendCode} disabled={busy}>
                    {busy ? 'Sending…' : 'Email me a code'}
                  </button>
                </div>
              )
            )}
            <div className="row">
              <button className="secondary" onClick={cancelPending} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Null is "not yet" and draws nothing. An empty list is a real answer
            and cannot happen — the device reading this page is on it. */}
        {devices?.map((device) => (
          <div className="device-row" key={device.id}>
            <div>
              <p className="device-name">{device.label}</p>
              <p className="device-detail">
                {howIn(device.method)}
                {device.count > 1 && ` · ${device.count} sign-ins`}
                {now && ` · last used ${ago(new Date(device.lastSeenAt), now)}`}
              </p>
            </div>
            {device.current && <span className="device-here">This device</span>}
            <button className="secondary" onClick={() => endOne(device)} disabled={busy}>
              Sign out
            </button>
          </div>
        ))}

        {!manageable && (
          /*
           * A native client still carrying a credential from before sessions
           * existed. Its row cannot be minted from a read, so the list is
           * missing the device asking — said out loud rather than left as a
           * list that is quietly incomplete.
           */
          <p className="muted">
            This app signed in before this screen existed, so it is not on the
            list. Signing out and back in adds it.
          </p>
        )}

        {others > 0 && (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="secondary" onClick={endOthers} disabled={busy}>
              Sign out everywhere else
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Passkeys</h2>
        <p className="muted">
          A passkey lets a device sign you in with Face ID, Touch ID or its
          screen lock, instead of a code from your inbox. A code always works
          too — removing every passkey does not lock you out.
        </p>

        {passkeys?.map((passkey) => (
          <div className="device-row" key={passkey.id}>
            <div>
              <p className="device-name">{passkey.label ?? 'A passkey'}</p>
              <p className="device-detail">
                {/* Whether it is synced decides whether losing the device loses
                    the key, which is the only thing about it worth printing. */}
                {passkey.backedUp ? 'Saved to your keychain' : 'On this device only'}
                {now &&
                  ` · ${
                    passkey.lastUsedAt
                      ? `last used ${ago(new Date(passkey.lastUsedAt), now)}`
                      : 'never used'
                  }`}
              </p>
            </div>
            <button className="secondary" onClick={() => removeKey(passkey)} disabled={busy}>
              Remove
            </button>
          </div>
        ))}

        {passkeys?.length === 0 && <p className="muted">No passkeys yet.</p>}

        {/* Drawn only where one could actually be made. A button that can only
            fail is worse than the sentence explaining its absence. */}
        {canPasskey && (
          <div className="row" style={{ marginTop: 16 }}>
            <button onClick={add} disabled={busy}>
              {busy ? 'Working…' : 'Add a passkey'}
            </button>
          </div>
        )}
      </section>

      {note && <p className="muted">{note}</p>}

      <div className="row">
        <button onClick={onDone}>Done</button>
      </div>
    </>
  );
}
