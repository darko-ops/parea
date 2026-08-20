'use client';

/**
 * A group — the running archive its docstring always claimed it was.
 *
 * What it actually was: a create form, then four bare blue links with a raw
 * ISO date beside each, then a Leave button loose in the footer. Three things
 * wrong with that, and they compound.
 *
 * The form was **first**, so a room whose whole premise is that something has
 * already happened here opened by asking you to type. It is a header button
 * now, and the form it opens is the same one field it always was.
 *
 * The archive was a list of words in a product whose subject is photographs.
 * Each album is a row with its picture, who is in it, how much of it there is
 * and when — under month headings, because an archive is read by when.
 *
 * And the people were a number. `11 members` on the screen whose entire
 * premise is that the same people keep turning up. They are faces now, with
 * the premise said once beside them.
 *
 * ## The non-member door
 *
 * Unchanged in substance and deliberately so. Somebody who is not in the group
 * learns its name and its size and nothing else — no faces, no album count, no
 * covers — because that is what `findable` means. The copy is verbatim.
 */

import { useCallback, useState } from 'react';

import type { GroupAlbum, GroupPerson } from '@/groups';

import { Face } from './Faces';
import { MemberPicker, nameOf, type Person } from './MemberPicker';
import { Menu } from './Menu';
import { SiteFooter } from './SiteFooter';
import { useImageFailure } from './useImageFailure';

type GroupData = {
  id: string;
  name: string;
  memberCount: number;
  member: boolean;
  role: 'member' | 'admin' | null;
  canJoinDirectly: boolean;
  /** Empty for a non-member — the door is handed nothing from inside. */
  albums: GroupAlbum[];
  people: GroupPerson[];
  /** The tile's colour, decided on the server so both screens agree. */
  lens: { fill: string; ink: string };
  /** Albums grouped by month, worded server-side. See the page. */
  months: { label: string; ids: string[] }[];
  /** "Fri 14 Mar" per album id, formatted on the server for the same reason. */
  dates: Record<string, string>;
};

export function GroupView({ group }: { group: GroupData }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [requested, setRequested] = useState(false);
  /** The create form, which is a panel under the header rather than the page. */
  const [creating, setCreating] = useState(false);
  /** The invite panel, and who is picked in it. Admins only — see the route. */
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);
  const [asked, setAsked] = useState<number | null>(null);

  /**
   * Sending the guest list.
   *
   * One call for the whole selection rather than one per person, matching the
   * album path — and the answer is a count rather than a per-person result,
   * because a per-person answer would report whether each one has blocked you.
   *
   * The panel stays open and says how many went. It does not optimistically
   * add anybody to the strip above: nobody is in the group yet, and drawing
   * them there would be the screen asserting a membership the server has
   * deliberately not written.
   */
  const invite = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${group.id}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorIds: picked.map((person) => person.actorId) }),
      });
      if (!res.ok) throw new Error('Could not ask them.');
      const { invited } = (await res.json()) as { invited: number };
      setAsked(invited);
      setPicked([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [group.id, picked]);

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${group.id}/members`, { method: 'POST' });
      if (res.ok) {
        window.location.reload();
        return;
      }
      // Not someone who has been to one of its events: they have to ask.
      const asked = await fetch(`/api/groups/${group.id}/requests`, { method: 'POST' });
      if (!asked.ok) throw new Error('Could not ask to join.');
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [group.id]);

  const createEvent = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newName, groupId: group.id }),
        });
        if (!res.ok) throw new Error('Could not create it.');
        const created = (await res.json()) as { url: string };
        window.location.href = created.url;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [group.id, newName],
  );

  if (!group.member) {
    /*
     * The door. A card with the name and the size on it, and nothing from
     * inside — no faces, no albums, no covers. That is not a styling
     * restriction, it is what `findable` promises: a findable group discloses
     * that it exists and how big it is so somebody can ask to come in.
     */
    return (
      <main className="group-page">
        <div className="door">
          <span
            className="group-tile door-tile"
            style={{ background: group.lens.fill, color: group.lens.ink }}
            aria-hidden="true"
          >
            {group.name.trim().slice(0, 1).toUpperCase()}
          </span>
          <h1>{group.name}</h1>
          <p className="door-size">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </p>
          {requested ? (
            <p className="door-said">
              Asked to join. Someone who runs this group will decide.
            </p>
          ) : (
            <>
              <p className="door-said">
                You can see that this group exists. You cannot see its photos
                until you are in it.
              </p>
              <button className="door-go" onClick={join} disabled={busy}>
                {group.canJoinDirectly ? 'Join' : 'Ask to join'}
              </button>
            </>
          )}
          {error && <p className="door-said">{error}</p>}
        </div>
        <SiteFooter />
      </main>
    );
  }

  const byId = new Map(group.albums.map((album) => [album.id, album]));

  return (
    <main className="group-page">
      {/* The list page is new, so the way back to it is drawn rather than
          assumed — this screen used to be reachable only from a link. */}
      <nav className="crumbs" aria-label="Where you are">
        <a href="/groups">Groups</a>
        <span aria-hidden="true">{'›'}</span>
        <span className="crumbs-here">{group.name}</span>
      </nav>

      <header className="group-head">
        <span
          className="group-tile group-head-tile"
          style={{ background: group.lens.fill, color: group.lens.ink }}
          aria-hidden="true"
        >
          {group.name.trim().slice(0, 1).toUpperCase()}
        </span>
        <div className="group-head-text">
          <h1>{group.name}</h1>
          <p className="group-head-meta">
            {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'} ·{' '}
            {group.albums.length} {group.albums.length === 1 ? 'album' : 'albums'}
            {group.role === 'admin' && ' · you run this'}
          </p>
        </div>
        <div className="group-actions">
          <button
            type="button"
            className="group-new"
            aria-expanded={creating}
            onClick={() => setCreating((was) => !was)}
          >
            New album here
          </button>
          {/*
            One item, and no "Manage group" beside it.

            The handoff asks for one for an admin, and there is no such screen:
            `/group/<id>` is the only group route this product has. A menu item
            leading to a 404 is worse than a menu with one thing in it, and
            building the screen is a separate ticket — group membership is
            opt-in by design, so "manage" would have to answer who may remove
            somebody and whether that is the same power as approving a join.
          */}
          <Menu label="More about this group" glyph="···" tone="quiet">
            {(close) => (
              <>
                {/*
                  Leaving is in the menu rather than loose in the page, which
                  is where it was. A destructive action sitting in the open at
                  the foot of a screen is one somebody presses while reaching
                  for something else — and the note under the archive is what
                  makes it safe to hide, because it says what leaving costs.
                */}
                <button
                  className="menu-danger"
                  onClick={async () => {
                    close();
                    await fetch(`/api/groups/${group.id}/members`, { method: 'DELETE' });
                    window.location.href = '/groups';
                  }}
                >
                  Leave this group
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      {creating && (
        <form className="group-create" onSubmit={createEvent}>
          <label htmlFor="ev" className="visually-hidden">
            What is it called?
          </label>
          <input
            id="ev"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Sunday roast"
            maxLength={120}
            required
            autoFocus
          />
          <button type="submit" disabled={busy || !newName.trim()}>
            Create it here
          </button>
          <p className="group-create-note">
            Everyone in the group can add photos without being invited.
          </p>
        </form>
      )}

      {error && <p className="group-error">{error}</p>}

      {/*
        The premise, said once, where the count used to be. A group exists
        because the same people keep turning up; this is the only line on the
        screen that says so, and it earns its place by standing in for a
        heading over the faces.
      */}
      <section className="people-strip">
        <span className="people-strip-label">The same people, every time</span>
        <div className="people-strip-row">
          {group.people.map((person) => (
            <span className="strip-person" key={person.actorId}>
              <Face
                src={person.avatarUrl}
                size={42}
                className="strip-face"
                fallback={
                  <span aria-hidden="true">
                    {person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
                  </span>
                }
              />
              <span className="strip-name">{person.firstName}</span>
            </span>
          ))}
          {/*
            Only for an admin, because only an admin may ask.

            That is the same power `group_join_request` gives them, pointed the
            other way: a stranger asking to come in, or the person who would
            answer that asking first. If any member could invite, the approval
            could be routed around by asking a friend on the inside — so the
            slot is simply absent for everybody else rather than present and
            refused.
          */}
          {group.role === 'admin' && (
            <button
              type="button"
              className="strip-person strip-add"
              aria-expanded={inviting}
              onClick={() => setInviting((was) => !was)}
            >
              <span className="strip-invite" aria-hidden="true">
                {'＋'}
              </span>
              <span className="strip-name">Invite</span>
            </button>
          )}
        </div>
      </section>

      {inviting && group.role === 'admin' && (
        <div className="group-invite">
          <MemberPicker picked={picked} onChange={setPicked} />
          <div className="group-invite-go">
            <span className="group-invite-note">
              {/*
                What being invited actually does, said where the decision is
                made. An admin pressing this is skipping the approval step —
                because they are the person who would have done the approving —
                and that is worth stating rather than leaving them to infer.
              */}
              They are asked, not added. Accepting is what puts somebody in.
            </span>
            <button type="button" onClick={invite} disabled={busy || picked.length === 0}>
              {busy
                ? 'Asking…'
                : picked.length === 0
                  ? 'Ask them'
                  : `Ask ${picked.length === 1 ? nameOf(picked[0]!) : `${picked.length} people`}`}
            </button>
          </div>
          {asked !== null && (
            <p className="group-invite-said">
              {asked === 0
                ? 'Nobody new to ask — they are already in, or already asked.'
                : `Asked ${asked} ${asked === 1 ? 'person' : 'people'}. They decide.`}
            </p>
          )}
        </div>
      )}

      {group.albums.length === 0 ? (
        /* With no archive, making one *is* the page — so the action comes to
           the front rather than staying behind the header button. */
        <div className="group-empty">
          <p>Nothing yet.</p>
          <button type="button" className="group-new" onClick={() => setCreating(true)}>
            New album here
          </button>
        </div>
      ) : (
        group.months.map((month) => (
          <section className="group-month" key={month.label}>
            <div className="day-head">
              <h2>{month.label}</h2>
              <span className="day-rule" aria-hidden="true" />
            </div>
            <div className="archive">
              {month.ids.map((id) => {
                const album = byId.get(id);
                if (!album) return null;
                return (
                  <a className="archive-row" href={`/event/${album.id}`} key={album.id}>
                    <span className="archive-cover">
                      {album.cover ? (
                        <AlbumCover src={album.cover} />
                      ) : (
                        <span className="archive-none" aria-hidden="true" />
                      )}
                      {album.fresh > 0 && (
                        <span className="fresh">
                          <span className="fresh-dot" aria-hidden="true" />
                          {album.fresh} new
                        </span>
                      )}
                    </span>
                    <span className="archive-what">
                      <span className="archive-line">
                        <span className="archive-name">{album.name}</span>
                        <span className="archive-when">{group.dates[album.id]}</span>
                      </span>
                      <span className="archive-meta">
                        <span className="archive-faces">
                          {album.faces.map((src, i) => (
                            <Face
                              key={i}
                              src={src}
                              size={20}
                              className="archive-face"
                              fallback={<span />}
                            />
                          ))}
                        </span>
                        {album.people} {album.people === 1 ? 'person' : 'people'} ·{' '}
                        {album.photoCount} {album.photoCount === 1 ? 'photo' : 'photos'}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/*
        The sentence that makes `Leave this group` safe to hide in a menu.
        Without it, leaving reads as though it might take the photographs with
        it — and somebody who believes that will never press it, or will press
        it and be frightened.
      */}
      <p className="group-note">
        Photos live in the albums, not in the group. Leaving stops the next one
        reaching you — it takes nothing away from the albums you were in.
      </p>

      <SiteFooter />
    </main>
  );
}

/**
 * An album's picture, which is presigned and therefore expires.
 *
 * A tab left open outlives the signature, and the browser's answer to that is
 * the broken-image glyph on a row whose whole job is to be recognisable. The
 * box keeps its size and falls back to the warm bed instead.
 */
function AlbumCover({ src }: { src: string }) {
  const { ref, failed, onError } = useImageFailure(src);
  if (failed) return <span className="archive-none" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt="" onError={onError} />;
}
