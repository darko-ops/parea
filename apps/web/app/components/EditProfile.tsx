'use client';

/**
 * Editing who you are: the picture, the handle, the name.
 *
 * Three fields with three different rules, so each says its own thing rather
 * than one Save button reporting that something somewhere was wrong. The
 * picture uploads on choosing, the handle is checked when you leave it, and
 * the name saves on blur like it does everywhere else.
 */

import { handleProblem, HANDLE_MAX } from '@parea/core';
import { useCallback, useRef, useState } from 'react';

import { Avatar } from './Avatar';

type Profile = {
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  /** "47" when a number is set. Never the number — see `phone.ts`. */
  phoneLast2?: string | null;
  avatarUrl: string | null;
};

export function EditProfile({
  profile,
  onSaved,
  onDone,
}: {
  profile: Profile;
  onSaved: () => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [handle, setHandle] = useState(profile.handle ?? '');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [picError, setPicError] = useState<string | null>(null);
  /*
   * The number is write-only from here.
   *
   * There is nothing to prefill it with: what the server holds is a hash and
   * two digits, and it could not send the number back if it wanted to. So the
   * box is empty with the masked digits beside it, which is also the honest
   * picture of what is stored.
   */
  const [phone, setPhone] = useState('');
  const [last2, setLast2] = useState(profile.phoneLast2 ?? null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const initial = (name.trim() || '?').slice(0, 1).toUpperCase();

  const savePhone = useCallback(async () => {
    setBusy(true);
    setPhoneError(null);
    try {
      const res = await fetch('/api/account/phone', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (res.ok) {
        setLast2(((await res.json()) as { last2: string }).last2);
        setPhone('');
        await onSaved();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // Two failures worth telling apart. One is a format nobody can guess is
      // wrong without being told which part; the other is a number that is
      // already somebody's, and re-typing it will not help.
      setPhoneError(
        body.error === 'already_claimed'
          ? 'That number is already on another account.'
          : 'Start with the country code, like +1 555 010 4477.',
      );
    } finally {
      setBusy(false);
    }
  }, [onSaved, phone]);

  const removePhone = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/account/phone', { method: 'DELETE' });
      setLast2(null);
      setPhoneError(null);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }, [onSaved]);

  const savePicture = useCallback(
    async (file: File) => {
      setBusy(true);
      setPicError(null);
      try {
        // The bytes as they are. Everything that makes them safe to store —
        // the strip, the resize, the re-encode — happens on the server, where
        // it cannot be skipped by a client that would rather not.
        const res = await fetch('/api/account/avatar', {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (res.status === 413) throw new Error('That picture is too large.');
        if (!res.ok) throw new Error('That did not look like an image we can read.');
        await onSaved();
      } catch (err) {
        setPicError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [onSaved],
  );

  const removePicture = useCallback(async () => {
    setBusy(true);
    await fetch('/api/account/avatar', { method: 'DELETE' }).catch(() => {});
    await onSaved();
    setBusy(false);
  }, [onSaved]);

  const saveHandle = useCallback(async () => {
    const next = handle.trim();
    if (next === (profile.handle ?? '')) return;

    // Checked here for an answer without a round trip; the server checks again
    // because this one can be skipped.
    const problem = next === '' ? null : handleProblem(next);
    if (problem) {
      setHandleError(problem);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setHandleError(body.message ?? 'That handle could not be saved.');
        return;
      }
      setHandleError(null);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }, [handle, onSaved, profile.handle]);

  /*
   * Saved on blur, like the name and the handle beside it.
   *
   * The whole screen works this way — there is no Save button, because every
   * field here is one fact and leaving it is the moment somebody has finished
   * saying it. A form that collects four facts and then asks you to confirm
   * them is a form; this is a profile.
   */
  const saveBio = useCallback(async () => {
    const next = bio.trim();
    if (next === (profile.bio ?? '')) return;
    await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bio: next }),
    }).catch(() => {});
    await onSaved();
  }, [bio, onSaved, profile.bio]);

  const saveName = useCallback(async () => {
    const next = name.trim();
    if (next === (profile.displayName ?? '')) return;
    await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: next }),
    }).catch(() => {});
    await onSaved();
  }, [name, onSaved, profile.displayName]);

  return (
    <section className="panel">
      <h2>Edit profile</h2>

      <div className="edit-pic">
        <Avatar url={profile.avatarUrl} initial={initial} />

        <div className="edit-pic-actions">
          {/* The input itself is hidden: the default control says "Choose
              File / no file selected", which is a sentence about a form
              rather than about a photograph of you. */}
          <input
            ref={fileRef}
            id="avatar"
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,image/webp,image/avif"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void savePicture(file);
            }}
          />
          <label className="button-like" htmlFor="avatar">
            {profile.avatarUrl ? 'Change picture' : 'Add a picture'}
          </label>
          {profile.avatarUrl && (
            <button className="secondary" onClick={removePicture} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>
      {picError && <p className="muted">{picError}</p>}

      <label htmlFor="edit-handle">Handle</label>
      <div className="handle-field">
        <span className="handle-at" aria-hidden="true">@</span>
        <input
          id="edit-handle"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setHandleError(null);
          }}
          onBlur={saveHandle}
          placeholder="yourname"
          maxLength={HANDLE_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <p className="muted">
        {handleError ??
          'Letters, numbers, underscores and full stops. Yours alone, and you can change it later.'}
      </p>

      <label htmlFor="edit-name" style={{ marginTop: 16 }}>
        Name
      </label>
      <input
        id="edit-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        placeholder="Your name"
        maxLength={80}
      />
      <p className="muted">Shown beside your photos. It does not have to be unique.</p>

      <label htmlFor="edit-bio" style={{ marginTop: 16 }}>
        About you
      </label>
      <textarea
        id="edit-bio"
        className="thread-field"
        rows={2}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        onBlur={saveBio}
        placeholder="A line about you"
        maxLength={200}
      />
      <p className="muted">
        Optional, and on your profile. Anybody who can see your profile can read
        it.
      </p>

      <label htmlFor="edit-phone" style={{ marginTop: 16 }}>
        Phone number
      </label>
      {last2 ? (
        <div className="row">
          <span className="phone-set">••• ••• ••{last2}</span>
          <button className="secondary small" onClick={removePhone} disabled={busy}>
            Remove
          </button>
        </div>
      ) : (
        <div className="row">
          <input
            id="edit-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 010 4477"
            autoComplete="tel"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="small" onClick={savePhone} disabled={busy || !phone.trim()}>
            Save
          </button>
        </div>
      )}
      {phoneError && <p className="muted">{phoneError}</p>}
      <p className="muted">
        Optional, and only so people who already have your number can find you.
        It is never shown to anybody and never appears on your profile — what is
        kept is a scrambled form of it and the last two digits, which is why the
        box above is empty even when a number is set.
      </p>

      <div className="row" style={{ marginTop: 20 }}>
        <button onClick={onDone} disabled={busy}>
          Done
        </button>
      </div>
    </section>
  );
}
