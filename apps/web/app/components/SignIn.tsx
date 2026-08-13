'use client';

/**
 * Signing in, wherever the refusal happened — design §3.
 *
 * One component rather than a link to `/account`, because the three places
 * that now need an account are all mid-task: creating an event, adding photos,
 * opening a private link. Sending someone away to sign in and back again loses
 * what they were doing, and on the upload path that is a file picker they have
 * already used.
 *
 * The two-step form itself is lifted from AccountView, which now renders this
 * rather than keeping a second copy. That page owns everything *around* signing
 * in — what you are in, deleting the account — and none of it belongs here.
 */

import { useCallback, useEffect, useState } from 'react';

type Stage = 'email' | 'code';

/**
 * Whether this browser is signed in.
 *
 * `null` while unknown, which callers must render as "not yet" rather than
 * "signed out" — a gate that flashes on every page load is worse than one that
 * appears a moment late, and the second is indistinguishable from a slow
 * network anyway.
 */
export function useSession(): {
  account: { email: string } | null;
  known: boolean;
  refresh: () => Promise<void>;
} {
  const [account, setAccount] = useState<{ email: string } | null>(null);
  const [known, setKnown] = useState(false);

  const refresh = useCallback(async () => {
    const session = await fetch('/api/account/session')
      .then((r) => r.json())
      .catch(() => ({ account: null }));
    setAccount(session.account ?? null);
    setKnown(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { account, known, refresh };
}

export function SignIn({
  title,
  why,
  onSignedIn,
}: {
  /**
   * A heading, on the page where signing in is the errand. Omitted where this
   * stands in front of something else — an upload gate with its own heading
   * would be two titles arguing about what the screen is.
   */
  title?: string;
  /** What the person was trying to do. Shown above the form. */
  why: string;
  onSignedIn: () => void | Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merged, setMerged] = useState(false);

  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 400) throw new Error('That does not look like an email address.');
      if (!res.ok) throw new Error('Could not ask for a code. Try again in a moment.');
      setStage('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [email]);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        throw new Error('That code did not work. Codes expire after ten minutes.');
      }
      const result = (await res.json()) as { merged: boolean };
      setMerged(result.merged);
      setCode('');
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [code, email, onSignedIn]);

  return (
    <section className="panel">
      {title && <h1 className="auth-title">{title}</h1>}
      <p>{why}</p>
      <p className="muted">
        No password — a code goes to your inbox. Your events follow you to
        another browser or a new phone.
      </p>

      <label htmlFor="signin-email">Email</label>
      <input
        id="signin-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={stage === 'code'}
      />

      {stage === 'code' && (
        <>
          <label htmlFor="signin-code" style={{ marginTop: 16 }}>
            The 6-digit code
          </label>
          <input
            id="signin-code"
            inputMode="numeric"
            // Lets a browser fill it straight from an SMS or mail hand-off.
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoFocus
          />
          <p className="muted">
            Sent, if that address is one we can reach. It works once and expires
            in ten minutes — check spam if it is not there.
          </p>
        </>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          onClick={stage === 'code' ? verify : request}
          disabled={busy || (stage === 'code' ? code.length < 6 : !email.includes('@'))}
        >
          {busy ? 'Working…' : stage === 'code' ? 'Sign in' : 'Send me a code'}
        </button>
        {stage === 'code' && (
          <button className="secondary" onClick={() => setStage('email')} disabled={busy}>
            Use a different address
          </button>
        )}
      </div>

      {merged && (
        // Said rather than done quietly: everything added in this browser has
        // just become part of another identity. That is the point of signing
        // in, and it should not be a surprise.
        <p className="muted">
          This browser has joined your account. Everything you added here is
          part of it now.
        </p>
      )}
      {error && <p className="muted">{error}</p>}
    </section>
  );
}
