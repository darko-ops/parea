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

/**
 * A number as an address book holds it, in the full international form the
 * server matches on — or null when there is no telling which country it is.
 *
 * Contacts are saved however somebody typed them: "+44 7700 900123",
 * "(555) 010-4477", "07700 900123". A number with its own country code is
 * taken as it is; a local one is read as belonging to `dialCode`, the
 * country this phone's own number is in, which is what the person who saved it
 * meant. Only the countries the product texts are read locally — a guess at
 * any other would match the wrong person or nobody.
 */
export function toE164(raw: string, dialCode: string): string | null {
  const compact = raw.replace(/[\s()\-. ]/g, '');
  let e164: string | null = null;
  if (compact.startsWith('+')) e164 = compact;
  else if (compact.startsWith('00')) e164 = `+${compact.slice(2)}`;
  else if (/^\d+$/.test(compact)) {
    if (dialCode === '+1') {
      if (compact.length === 10) e164 = `+1${compact}`;
      else if (compact.length === 11 && compact.startsWith('1')) e164 = `+${compact}`;
    } else if (dialCode === '+44') {
      if (compact.length === 11 && compact.startsWith('0')) e164 = `+44${compact.slice(1)}`;
    }
  }
  return e164 && /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

/**
 * The builds whose contacts permission promises the address book is never
 * uploaded. Build 7 asked under those words, and an update cannot change a
 * permission dialog, so on these the list stays on the phone as promised and
 * only a build that asks in the new words checks it against Parea.
 */
const NEVER_UPLOADED_RUNTIMES = new Set(['e506cf04f5fe512ee6a498b37177837d4dee35d9']);

export function contactMatchingAllowed(runtimeVersion: string | null | undefined): boolean {
  return !runtimeVersion || !NEVER_UPLOADED_RUNTIMES.has(runtimeVersion);
}
