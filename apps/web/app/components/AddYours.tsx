'use client';

/**
 * Adding photos to an event without opening it.
 *
 * The point of the hero on Home is that the event still filling up is the one
 * you have something to contribute to, and making somebody navigate into it
 * first is a step between them and the only thing the product wants them to
 * do. So the picker is here, on the list.
 *
 * It is the same queue the event page uses, keyed by the same event id, and
 * that is what makes this safe rather than a second upload path: the queue
 * persists to IndexedDB as it goes, so somebody who picks forty photos here
 * and then opens the event finds the batch already running on that screen —
 * `useUploads` restores whatever the last tab left behind, and this is that
 * mechanism used deliberately rather than as recovery.
 *
 * A hidden input with a label over it, not a button calling `.click()`. A
 * label *is* the control for the input it names: keyboard, pointer and screen
 * reader all work with nothing scripted, and there is no window in which the
 * control is on screen but the handler has not attached yet.
 *
 * It sits *beside* the hero's link rather than inside it — an `<a>` may not
 * contain a label or an input, and the version of this that wrapped the whole
 * card in an anchor and stopped the click from propagating was invalid markup
 * doing by hand what the stretched-link pattern in `globals.css` does
 * correctly. The card is still one click target; see `.hero-name a::after`.
 *
 * The one thing it must not do is claim to be finished. Uploads do not survive
 * the tab closing, and a button that goes back to saying "Add yours" the
 * moment the files are handed over would be telling somebody it is safe to
 * leave. So it counts down, in the hero, until it is actually done.
 */

import { ACCEPT_ATTRIBUTE, acceptedMime } from '@parea/upload';
import { useCallback, useRef, useState } from 'react';

import { useUploads } from './useUploads';

export function AddYours({ eventId }: { eventId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploads = useUploads(eventId);
  /** How many of the last selection were not photos. */
  const [skipped, setSkipped] = useState(0);

  const pick = useCallback(
    async (picked: File[]) => {
      // `accept` is advice, not a rule — a drop or "All Files" in the OS
      // dialog gets past it, and the presign endpoint refuses the whole batch
      // if one file is unacceptable. Filtering here is the difference between
      // losing one video and losing the two hundred photos beside it.
      const usable = picked.filter(
        (file) => file.type === '' || acceptedMime(file.type) !== null,
      );
      setSkipped(picked.length - usable.length);
      if (usable.length > 0) await uploads.add(usable);
      if (inputRef.current) inputRef.current.value = '';
    },
    [uploads],
  );

  const id = `add-yours-${eventId}`;

  return (
    <div className="add-yours">
      <label
        className="hero-go"
        htmlFor={id}
        // `aria-disabled` and not `disabled`, which a label does not have. The
        // input underneath carries the real one, so a press mid-batch already
        // does nothing; this is so it does not look like it should.
        aria-disabled={uploads.running || undefined}
      >
        {uploads.running
          ? `${uploads.remaining} to go`
          : 'Add yours'}
      </label>
      <input
        id={id}
        className="visually-hidden"
        ref={inputRef}
        type="file"
        multiple
        // The same list the presign endpoint enforces, spelled out rather than
        // an image wildcard: the wildcard offers TIFF, BMP and SVG, which the
        // server then refuses, and one refusal fails the whole batch.
        accept={ACCEPT_ATTRIBUTE}
        disabled={uploads.running}
        onChange={(e) => pick(Array.from(e.target.files ?? []))}
      />
      {/*
        Both of these are said on the event page too, at length. Here they are
        one line, because the hero is a card in a list and a paragraph of
        upload caveats in it would bury the four events underneath.
      */}
      {uploads.running && (
        <span className="hero-note">Keep this tab open</span>
      )}
      {!uploads.running && skipped > 0 && (
        <span className="hero-note">
          {skipped === 1 ? '1 file was' : `${skipped} files were`} not a photo
        </span>
      )}
    </div>
  );
}
