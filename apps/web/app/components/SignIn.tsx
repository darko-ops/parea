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
 * ## Sign in, or create an account — and a passkey only after there is one
 *
 * This used to open on two equal ways in, a passkey above an email form, and
 * somebody who had never made an account had no way to tell which was theirs —
 * a passkey cannot exist before an account does, so the first button on the
 * screen was one a newcomer could only fail at.
 *
 * So the card asks the question a person can answer: are you signing in, or
 * making an account? Both are an email and a code underneath — the server makes
 * the account at the first code to a new address — but saying which is which
 * lets each say only what it needs to.
 *
 * A passkey is offered only under Sign in, and only in a browser that has been
 * signed in to an account before (`HAD_ACCOUNT_KEY`). Anywhere else it is a
 * button that can only fail. Somebody whose passkey syncs to a browser this
 * one has never seen signs in with a code once, and it appears after that.
 *
 * Signing in with an address that has no account does not quietly make one:
 * it says so, and offers to. Making an account with an address that already has
 * one simply signs in — there is nothing to refuse.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  addPasskey,
  CANCELLED,
  passkeysAvailable,
  platformAuthenticator,
  signInWithPasskey,
  SUSPENDED_NOTE,
} from './passkey';

/**
 * `offer` is the step after being let in, not a step towards it — see the note
 * where it is set. Everything before it is the two-field form this screen has
 * always been.
 */
type Stage = 'email' | 'code' | 'missing' | 'exists' | 'age' | 'refused' | 'offer';

/** Which question the person answered on the first screen. */
type Mode = 'signin' | 'create';

/**
 * This browser has been signed in to an account at least once — the condition
 * for offering a passkey, and for opening on Sign in rather than Create
 * account. Kept through sign-out, which is exactly when it matters. A hint and
 * not a lock: clearing it only means seeing Create account first.
 */
const HAD_ACCOUNT_KEY = 'parea.had-account';
const hadAccount = () => {
  try {
    return globalThis.localStorage?.getItem(HAD_ACCOUNT_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberAccount = () => {
  try {
    globalThis.localStorage?.setItem(HAD_ACCOUNT_KEY, '1');
  } catch {
    // Blocked storage: this browser just keeps opening on Create account.
  }
};

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
    // A browser seen signed in counts as having had an account — which is how
    // everybody signed in before `HAD_ACCOUNT_KEY` existed gets it too.
    if (session.account) rememberAccount();
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
  const [mode, setMode] = useState<Mode>('create');
  /** See `HAD_ACCOUNT_KEY`. Read after mount, for the reason `canPasskey` is. */
  const [returning, setReturning] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merged, setMerged] = useState(false);
  /** From the answer that asked for a date of birth. See the age check. */
  const [proof, setProof] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState('');
  /*
   * The rest of Create account, asked on the form itself rather than after the
   * code. They used to appear only once the code proved a new address, so
   * anybody whose address already had an account — or who never got that far —
   * never saw the date of birth or the terms at all, and the account had no
   * name until somebody went looking for Edit profile.
   */
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);

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
    const before = hadAccount();
    setReturning(before);
    if (before) setMode('signin');
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

  /**
   * What happens once an account has answered — the same after a code and
   * after the date of birth that a first sign-in asks for.
   */
  const finish = useCallback(
    async (res: Response) => {
      const result = (await res.json()) as {
        merged: boolean;
        created: boolean;
        hasPasskey: boolean;
      };
      setMerged(result.merged);
      setCode('');
      rememberAccount();

      /*
       * The one moment worth interrupting for.
       *
       * Somebody who has just created an account has also just typed a code out
       * of an inbox, so "next time, use Face ID" lands on the one screen where
       * the cost of the alternative is fresh. Any later and it is an
       * interruption; in Settings it is a thing nobody goes looking for.
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
    },
    [onSignedIn],
  );

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Create account sends everything at once; the server uses the date
        // and the name only if this address turns out to be new.
        body: JSON.stringify(
          mode === 'create'
            ? { email, code, birthDate, displayName: name.trim(), intent: 'create' }
            : { email, code },
        ),
      });
      if (res.status === 409) {
        // Create account, and the address already has one. See the route.
        setCode('');
        setStage('exists');
        return;
      }
      if (res.status === 403) {
        // Two refusals share the status, and only one is about age. A
        // suspension offered "change date of birth" would be offered a way
        // round a decision that has nothing to do with a date.
        const body = (await res.json().catch(() => ({}))) as { error?: string; proof?: string };
        if (body.error === 'suspended') throw new Error(SUSPENDED_NOTE);
        // The code is spent; the proof lets a wrong date be put right.
        setCode('');
        setProof(body.proof ?? null);
        setStage('refused');
        return;
      }
      if (res.status === 400) {
        // The code was good and is spent; the proof lets the date be fixed
        // without another.
        const body = (await res.json().catch(() => ({}))) as { proof?: string };
        if (body.proof) {
          setProof(body.proof);
          setStage('age');
          throw new Error('That date does not look right. Check it and try again.');
        }
      }
      if (res.status === 429) {
        // Not the same sentence as a bad code: somebody holding a good one was
        // told it had failed, and asked for another they could not have.
        throw new Error('Too many tries from here. Wait an hour, then use the code you have.');
      }
      /*
       * The code was right and the address is new: a first account asks for a
       * date of birth. Not before the code, because only a proved address can
       * be told it has no account.
       */
      if (res.status === 428) {
        const body = (await res.json()) as { proof?: string };
        setCode('');
        setProof(body.proof ?? null);
        // Signing in to an address with no account says so rather than
        // making one behind their back; Create account carries straight on.
        setStage(mode === 'create' ? 'age' : 'missing');
        return;
      }
      if (!res.ok) {
        throw new Error('That code did not work. Codes expire after ten minutes.');
      }
      await finish(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [birthDate, code, email, finish, mode, name]);

  /** The date of birth, for the sign-in that makes the account. */
  const confirmAge = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, proof, birthDate, displayName: name.trim() }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; proof?: string };
        if (body.error === 'suspended') throw new Error(SUSPENDED_NOTE);
        setProof(body.proof ?? null);
        setStage('refused');
        return;
      }
      if (res.status === 400) {
        const body = (await res.json()) as { proof?: string };
        if (body.proof) setProof(body.proof);
        throw new Error('That date does not look right. Check it and try again.');
      }
      if (res.status === 401) {
        // The ten minutes the address stays proved have passed.
        setStage('email');
        throw new Error('That took a while. Ask for a new code to carry on.');
      }
      if (!res.ok) throw new Error('Could not make the account. Try again in a moment.');
      await finish(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [birthDate, email, finish, name, proof]);

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
      rememberAccount();
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
  /*
   * A first account: the date of birth, and the terms, on one screen.
   *
   * The date is asked for without saying what it is checked against — a
   * screen that names the cutoff answers its own question — and it is not
   * kept: only the fact that the check passed goes on the account.
   */
  if (stage === 'exists') {
    return (
      <section className="panel">
        <h2>You already have an account</h2>
        <p className="muted">
          {email} is already signed up to Parea. Sign in to it instead — we will
          send a new code.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button"
            onClick={() => {
              setMode('signin');
              void request();
            }}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Sign in instead'}
          </button>
          <button type="button"
            className="secondary"
            onClick={() => setStage('email')}
            disabled={busy}
          >
            Use a different address
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
      </section>
    );
  }

  if (stage === 'missing') {
    return (
      <section className="panel">
        <h2>No account for that address</h2>
        <p className="muted">
          {email} is not signed up to Parea yet. Make an account with it, or
          sign in with the address you used before.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button"
            onClick={() => {
              setMode('create');
              setStage('age');
            }}
          >
            Create an account
          </button>
          <button type="button"
            className="secondary"
            onClick={() => {
              setProof(null);
              setStage('email');
            }}
          >
            Use a different address
          </button>
        </div>
      </section>
    );
  }

  if (stage === 'age') {
    return (
      <section className="panel">
        <h2>Finish your account</h2>
        <p className="muted">
          {email} is new to Parea, so this makes your account.
        </p>
        <AccountFields
          name={name}
          setName={setName}
          birthDate={birthDate}
          setBirthDate={setBirthDate}
          agreed={agreed}
          setAgreed={setAgreed}
        />
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" onClick={confirmAge} disabled={busy || !name.trim() || !birthDate || !agreed}>
            {busy ? 'Working…' : 'Create account'}
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
      </section>
    );
  }

  if (stage === 'refused') {
    return (
      <section className="panel">
        <h2>You can&rsquo;t make an account yet</h2>
        <p className="muted">
          Parea isn&rsquo;t available to you right now. You can still open rolls
          people send you.
        </p>
        {/*
          A wrong date is the commonest way here — a year left at this one — so
          it can be fixed. With the proof the date goes straight back; once its
          ten minutes are up, the address needs a new code first.
        */}
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button"
            className="secondary"
            onClick={() => {
              setError(null);
              setStage(proof ? 'age' : 'email');
            }}
          >
            Change date of birth
          </button>
        </div>
      </section>
    );
  }

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
          <button type="button" onClick={keepPasskey} disabled={busy}>
            {busy ? 'Working…' : 'Add a passkey'}
          </button>
          <button type="button" className="secondary" onClick={() => void onSignedIn()} disabled={busy}>
            Not now
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
      </section>
    );
  }

  const creating = mode === 'create';
  /*
   * Whether the main button can be pressed, and what pressing it does — named
   * once, because Enter in either field presses it too.
   *
   * Every button here is `type="button"`, and that is the fix for a sign-in
   * that sent code after code. This card is drawn inside other forms — the
   * Create Roll page wraps it in its own — and a button with no type is a
   * submit button. Pressing Go on a phone's keyboard, or a browser filling the
   * code from Mail and submitting, "clicks" the first submit button in the
   * form: the Sign in tab at the top, which puts the card back to its email
   * step. So nothing here submits, and Enter is handled where it is pressed.
   */
  const ready =
    !busy &&
    (stage === 'code'
      ? code.length >= 6
      : email.includes('@') && !(creating && (!name.trim() || !birthDate || !agreed)));
  const submit = () => {
    if (!ready) return;
    void (stage === 'code' ? verify() : request());
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
  };
  const choose = (next: Mode) => {
    setMode(next);
    setStage('email');
    setCode('');
    setError(null);
  };

  return (
    <section className="panel">
      {title && <h1 className="auth-title">{title}</h1>}
      <p>{why}</p>

      {/* The one question a newcomer can answer, before anything else. */}
      <div className="auth-switch" role="tablist" aria-label="Sign in or create an account">
        <button type="button"
          role="tab"
          aria-selected={!creating}
          className={!creating ? 'on' : ''}
          onClick={() => choose('signin')}
          disabled={busy}
        >
          Sign in
        </button>
        <button type="button"
          role="tab"
          aria-selected={creating}
          className={creating ? 'on' : ''}
          onClick={() => choose('create')}
          disabled={busy}
        >
          Create account
        </button>
      </div>

      <p className="muted">
        {creating
          ? 'No password. Enter your email and we will send a code to make your account.'
          : 'Enter the email you signed up with and we will send you a code.'}
      </p>

      {creating && stage === 'email' && (
        <>
          <label htmlFor="signin-name">Your name</label>
          <input
            id="signin-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What friends call you"
            maxLength={80}
          />
        </>
      )}

      <label htmlFor="signin-email" style={creating && stage === 'email' ? { marginTop: 16 } : undefined}>
        Email
      </label>
      <input
        id="signin-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={stage === 'code'}
        onKeyDown={onEnter}
      />

      {creating && stage === 'email' && (
        <AccountFields
          birthDate={birthDate}
          setBirthDate={setBirthDate}
          agreed={agreed}
          setAgreed={setAgreed}
        />
      )}

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
            onKeyDown={onEnter}
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
        <button type="button"
          onClick={submit}
          disabled={!ready}
        >
          {busy
            ? 'Working…'
            : stage === 'code'
              ? creating
                ? 'Create account'
                : 'Sign in'
              : 'Send me a code'}
        </button>
        {stage === 'code' && (
          <button type="button" className="secondary" onClick={() => setStage('email')} disabled={busy}>
            Use a different address
          </button>
        )}
      </div>

      {/*
        Second, smaller, and only where it can work: under Sign in, in a browser
        that has held an account before. See `HAD_ACCOUNT_KEY`.
      */}
      {!creating && returning && canPasskey && stage === 'email' && (
        <>
          <p className="signin-or">or</p>
          <div className="row">
            <button type="button" className="secondary" onClick={withPasskey} disabled={busy}>
              Sign in with a passkey
            </button>
          </div>
        </>
      )}

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

/**
 * The date of birth and the terms, and the name where the form has not already
 * asked for it — the part of Create account that is not an email and a code.
 *
 * The terms are a box to tick rather than a sentence under a button, because a
 * sentence nobody has to touch is a sentence nobody can be said to have read.
 * The date is asked without naming the cutoff — a screen that names it answers
 * its own question — and is not kept: only the fact that the check passed goes
 * on the account.
 */
function AccountFields({
  name,
  setName,
  birthDate,
  setBirthDate,
  agreed,
  setAgreed,
}: {
  name?: string;
  setName?: (value: string) => void;
  birthDate: string;
  setBirthDate: (value: string) => void;
  agreed: boolean;
  setAgreed: (value: boolean) => void;
}) {
  /*
   * Day, month and year as three empty boxes, as the app asks, rather than a
   * date input. A phone's date picker opens on today, and somebody who turns
   * the day and the month but not the year has told the age check they were
   * born this year. A year has to be typed.
   *
   * The parent holds the date only once all three make one; until then it is
   * empty, which keeps Create account disabled. Started from the parent's,
   * because the form can remount between the email and the age stages.
   */
  const [initialYear = '', initialMonth = '', initialDay = ''] = birthDate ? birthDate.split('-') : [];
  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const update = (next: { day?: string; month?: string; year?: string }) => {
    const parts = { day, month, year, ...next };
    for (const key of ['day', 'month', 'year'] as const) parts[key] = parts[key].replace(/\D/g, '');
    setDay(parts.day);
    setMonth(parts.month);
    setYear(parts.year);
    setBirthDate(
      parts.day && parts.month && parts.year.length === 4
        ? `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`
        : '',
    );
  };
  return (
    <>
      {setName && (
        <>
          <label htmlFor="account-name">Your name</label>
          <input
            id="account-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What friends call you"
            maxLength={80}
            autoFocus
          />
        </>
      )}
      <label htmlFor="account-birth-day" style={{ marginTop: 16 }}>
        Date of birth
      </label>
      <div className="birth-date">
        <input
          id="account-birth-day"
          type="text"
          inputMode="numeric"
          autoComplete="bday-day"
          maxLength={2}
          placeholder="Day"
          aria-label="Day you were born"
          value={day}
          onChange={(e) => update({ day: e.target.value })}
        />
        <input
          type="text"
          inputMode="numeric"
          autoComplete="bday-month"
          maxLength={2}
          placeholder="Month"
          aria-label="Month you were born, as a number"
          value={month}
          onChange={(e) => update({ month: e.target.value })}
        />
        <input
          type="text"
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          placeholder="Year"
          aria-label="Year you were born"
          value={year}
          onChange={(e) => update({ year: e.target.value })}
        />
      </div>
      <p className="muted">Used to check you can make an account, and not kept.</p>
      <label className="auth-agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I agree to the <a href="/terms">Terms</a> and the <a href="/privacy">Privacy Policy</a>.
        </span>
      </label>
    </>
  );
}
