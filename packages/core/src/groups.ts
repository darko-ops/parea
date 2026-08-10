/**
 * Groups — docs/design.md §3.
 *
 * The answer to the distribution problem. A one-off event has to solve "how do
 * I reach everyone" from scratch every time; a group solves it once, and the
 * next event reaches its members directly instead of chasing a dozen people
 * through separate conversations.
 *
 * Deliberately thin, and it should stay that way: a name, a member list, and
 * the events under it. No profiles, no bios, no public pages, no follower
 * counts. The feature test from the concept applies — does this help people
 * contribute, find, or retrieve shared photos?
 */

import { randomBytes } from 'node:crypto';

/**
 * A slug for a group, from its name.
 *
 * System-suffixed rather than user-chosen, for the same reason event codes
 * are: a namespace people can pick from gets squatted, and then it needs
 * moderation and a trademark policy. The suffix means two houses can both be
 * called "The Flat" without either owning the name.
 */
export function groupSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'group';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * What a stranger may learn about a findable group.
 *
 * The governing rule is that groups can be findable and photos never are, so
 * search returns a door: enough to recognise the group you meant, and nothing
 * about what is inside it.
 */
export type GroupDoor = {
  id: string;
  name: string;
  memberCount: number;
};
