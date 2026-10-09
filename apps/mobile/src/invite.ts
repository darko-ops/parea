/**
 * The plain parts of inviting a contact, apart from the screen so they can be
 * tested without React Native. See `InviteContacts.tsx`.
 */

/** One row: one person, one number to text. */
export type PhoneContact = { id: string; name: string; number: string };

/**
 * The address book as rows: everybody with a number, once each, by name.
 *
 * A contact with several numbers is texted at the mobile one when a label says
 * which that is, and at the first otherwise — a landline cannot receive a text
 * and "mobile" and "iPhone" are what both platforms call the one that can.
 */
export function toRows(
  details: { id: string; fullName?: string | null; phones?: { label?: string | null; number?: string | null }[] | null }[],
): PhoneContact[] {
  const rows: PhoneContact[] = [];
  for (const contact of details) {
    const phones = (contact.phones ?? []).filter((p) => p.number && p.number.trim());
    if (phones.length === 0) continue;
    const mobile = phones.find((p) => /mobile|iphone|cell/i.test(p.label ?? '')) ?? phones[0]!;
    const name = contact.fullName?.trim() || mobile.number!.trim();
    rows.push({ id: contact.id, name, number: mobile.number!.trim() });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function inviteText(link: string): string {
  return `Join me on Parea so we can share photos: ${link}`;
}
