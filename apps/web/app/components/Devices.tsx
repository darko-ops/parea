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
};

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
    const [sessions, keys] = await Promise.all([
      fetch('/api/account/devices').then((r) => r.json()).catch(() => ({ devices: [] })),
      fetch('/api/account/passkeys').then((r) => r.json()).catch(() => ({ passkeys: [] })),
    ]);
    setDevices(sessions.devices ?? []);
    setManageable(sessions.manageable !== false);
    setPasskeys(keys.passkeys ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const endOne = useCallback(
    async (device: Device) => {
      const message = device.current
        ? 'Sign out of this device? You will need to sign in again here.'
        : `Sign out of ${device.label}? It will need to sign in again.`;
      if (!confirm(message)) return;

      setBusy(true);
      try {
        await fetch(`/api/account/devices/${device.id}`, { method: 'DELETE' });
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
        await load();
        setNote(`${device.label} was signed out.`);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const endOthers = useCallback(async () => {
    if (!confirm('Sign out everywhere except this device?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/devices', { method: 'DELETE' });
      const { ended } = (await res.json().catch(() => ({ ended: 0 }))) as { ended: number };
      await load();
      setNote(
        ended === 0
          ? 'Nothing else was signed in.'
          : `${ended} ${ended === 1 ? 'device was' : 'devices were'} signed out.`,
      );
    } finally {
      setBusy(false);
    }
  }, [load]);

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

  const others = (devices ?? []).filter((device) => !device.current).length;

  return (
    <>
      <section className="panel">
        <h2>Where you are signed in</h2>
        <p className="muted">
          Every browser and app holding your account. Sign one out if you do not
          recognise it, or if you have lent it to somebody.
        </p>

        {/* Null is "not yet" and draws nothing. An empty list is a real answer
            and cannot happen — the device reading this page is on it. */}
        {devices?.map((device) => (
          <div className="device-row" key={device.id}>
            <div>
              <p className="device-name">{device.label}</p>
              <p className="device-detail">
                {howIn(device.method)}
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
