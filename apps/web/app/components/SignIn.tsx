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
 *
 * ## Two ways in, and the order they are offered in
 *
 * A passkey is first on the screen and second in the code, and both are
 * deliberate. It is first because for anybody who has one it is the whole
 * interaction — a tap and a face, no inbox — and a form above it would be a
 * form they have to look past every time. It is second in the file because the
 * code path is the one that always works: it is what creates an account, what
 * gets somebody in on a device they have never held, and what is left when a
 * passkey is on a phone that is at home. Nothing here ever hides it.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  addPasskey,
  CANCELLED,
  passkeysAvailable,
  platformAuthenticator,
  signInWithPasskey,
} from './passkey';

/**
 * `offer` is the step after being let in, not a step towards it — see the note
 * where it is set. Everything before it is the two-field form this screen has
 * always been.
 */
type Stage = 'email' | 'code' | 'offer';

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

  /*
   * Whether to draw the passkey button, decided after mount.
   *
   * Not during render: `window.PublicKeyCredential` does not exist on the
   * server, so a component that reads it while rendering produces markup the
   * client disagrees with. Null is "not yet", and draws nothing — a button that
   * appears a frame late is better than a hydration mismatch on the sign-in
   * screen.
   */
  const [canPasskey, setCanPasskey] = useState<boolean | null>(null);
  /** Whether Face ID and Touch ID specifically, for the words in the offer. */
  const [onThisDevice, setOnThisDevice] = useState(false);

  useEffect(() => {
    setCanPasskey(passkeysAvailable());
    void platformAuthenticator().then(setOnThisDevice);
  }, []);

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
      // A 429 describes this caller and no address, so it is the one refusal
      // here that can be repeated honestly — and the only one where "try again
      // in a moment" is advice that cannot work.
      if (res.status === 429) {
        throw new Error('Too many codes asked for from here. Try again in an hour.');
      }
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
      if (res.status === 429) {
        // Not the same sentence as a bad code: somebody holding a good one was
        // told it had failed, and asked for another they could not have.
        throw new Error('Too many tries from here. Wait an hour, then use the code you have.');
      }
      if (!res.ok) {
        throw new Error('That code did not work. Codes expire after ten minutes.');
      }
      const result = (await res.json()) as {
        merged: boolean;
        created: boolean;
        hasPasskey: boolean;
      };
      setMerged(result.merged);
      setCode('');

      /*
       * The one moment worth interrupting for.
       *
       * Somebody who has just created an account has also just typed a code out
       * of an inbox, so "next time, use Face ID" lands on the one screen where
       * the cost of the alternative is fresh. Any later and it is an
       * interruption; in Settings it is a thing nobody goes looking for.
       *
       * Three conditions, and each removes a case where the card would be a
       * nuisance rather than an offer: only on the sign-in that made the
       * account, only if there is no passkey already on it, and only where the
       * browser could actually make one. Failing any of them hands off exactly
       * as this screen always did.
       *
       * `onSignedIn` is *not* called yet, which is the whole mechanism: it
       * navigates, and a card rendered after it would be a card on a page that
       * is being replaced. Both buttons on the offer call it.
       */
      if (result.created && !result.hasPasskey && passkeysAvailable()) {
        setStage('offer');
        return;
      }

      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [code, email, onSignedIn]);

  /**
   * Signing in with a passkey, which is one press and no form.
   *
   * No offer afterwards: somebody who just used a passkey has one.
   */
  const withPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithPasskey();
      if (!result.ok) {
        // A cancellation says nothing. They pressed Escape, and a red line
        // about it reads as a fault in the thing they decided against.
        if (result.message !== CANCELLED) setError(result.message);
        return;
      }
      setMerged(result.value.merged);
      await onSignedIn();
    } finally {
      setBusy(false);
    }
  }, [onSignedIn]);

  /** Taking the offer, or declining it. Either way the hand-off happens. */
  const keepPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await addPasskey();
      if (!result.ok && result.message !== CANCELLED) {
        /*
         * Said, and then carried on anyway.
         *
         * A passkey that could not be made is not a failed sign-in — they are
         * signed in, and the account exists. Leaving them on this card with an
         * error would turn a declined extra into a dead end, so the message is
         * shown and the hand-off still runs.
         */
        setError(result.message as string);
      }
    } finally {
      setBusy(false);
      await onSignedIn();
    }
  }, [onSignedIn]);

  /*
   * Signed in already, being asked one question before carrying on.
   *
   * A separate return rather than a branch inside the form, because none of the
   * form belongs on it: there is no address to type, no code, and nothing to go
   * back to. Leaving the fields on screen would invite somebody to sign in
   * again on top of the session they already have.
   */
  if (stage === 'offer') {
    return (
      <section className="panel">
        <h2>Next time, {onThisDevice ? 'sign in with Face ID' : 'skip the code'}</h2>
        {/*
          Two sentences, because there are two moments and only one of them is
          fast.

          This said "add a passkey and this device will let you straight in",
          which is true of every sign-in after the first and not of the next
          thirty seconds: the browser asks where to keep the key — a keychain, a
          password manager — and that prompt arrives immediately after a button
          promising no further steps. The site cannot remove it and should not
          want to, since a site that could choose where a credential is filed
          could steer somebody off their own password manager.

          So the setup is described as setup and the payoff as the payoff. The
          order matters too: the cost is named first, because a promise followed
          by a caveat reads as a promise that was not kept.
        */}
        <p className="muted">
          {onThisDevice
            ? 'Setting one up takes a moment — your browser will ask where to keep it. After that, signing in here is Face ID, Touch ID or your screen lock, with no code to fetch.'
            : 'Setting one up takes a moment — your browser will ask where to keep it, and may ask for your phone. After that, signing in here is one prompt, with no code to fetch.'}
        </p>
        {/*
          Said plainly, because it is the question somebody actually has. A
          passkey that replaced the code would be a passkey that locks you out
          of your own photographs from a borrowed laptop.
        */}
        <p className="muted">
          You can still sign in with a code whenever you need to — this is an
          extra, not a replacement.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={keepPasskey} disabled={busy}>
            {busy ? 'Working…' : 'Add a passkey'}
          </button>
          <button className="secondary" onClick={() => void onSignedIn()} disabled={busy}>
            Not now
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      {title && <h1 className="auth-title">{title}</h1>}
      <p>{why}</p>

      {/*
        The passkey first, for anybody who has one — it is the whole
        interaction, and a form above it is a form to look past every time.
        Drawn only once the browser has been asked whether it can: see
        `canPasskey`.
      */}
      {canPasskey && stage === 'email' && (
        <>
          <div className="row">
            <button onClick={withPasskey} disabled={busy}>
              {busy ? 'Working…' : 'Sign in with a passkey'}
            </button>
          </div>
          <p className="muted">
            Face ID, Touch ID, or whatever unlocks your device.
          </p>
          {/* A separator that says the two are alternatives, not steps. */}
          <p className="signin-or">or</p>
        </>
      )}

      <p className="muted">
        No password — a code goes to your inbox. Your albums follow you to
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
