/**
 * Telling the deriver a photo is waiting, instead of it asking every five
 * seconds whether one might be.
 *
 * The asking was the cost. Neon suspends a compute once nothing is connected,
 * so a poll loop is a machine that never lets the database sleep — forty days
 * of an idle worker exhausted a month's quota and took sign-in with it. The
 * queries were free; being awake was not.
 *
 * QStash delivers one signed HTTP request per photo to the deriver, which
 * answers only when the photo is derived. Between uploads there is nothing
 * running: no timer here, no loop there, and a database that is allowed to
 * sleep.
 *
 * ## Why a failure here fails the request
 *
 * Because after this there is nothing else looking. Under the old design a
 * dropped wake-up cost nothing — the next poll found the row anyway — and
 * that safety net is exactly what is being removed. A publish that fails
 * silently is a photograph that is never derived and never reported.
 *
 * `complete` is safe to call again: it re-heads storage and rewrites the same
 * timestamp. So the honest answer to a failed publish is to fail the request
 * and let the client send it again, which is a retry the uploader can see. The
 * alternative — answering 200 and hoping — is how a queue becomes less
 * reliable than the poll it replaced.
 *
 * ## Why an unconfigured queue is not a failure
 *
 * Development has no QStash and does not need one: `deriver watch` still
 * polls, which is the right trade against a local database nobody is billed
 * for. Absent configuration means "something else will find this", which is
 * true there and false in production — where `env.ts` reports it missing and
 * the health check says so.
 */

import { Client } from '@upstash/qstash';

export type PublishResult = 'published' | 'not-configured';

/**
 * What QStash will accept as a deduplication id.
 *
 * Narrower than the documented rule on purpose. The rule that bit was "cannot
 * contain ':'", and a fix that removed exactly the colon would be a fix
 * against one example of a constraint nobody here can see — the next
 * separator somebody reaches for is as likely to be refused as the last one.
 *
 * So the key is built rather than interpolated, and anything outside
 * `[A-Za-z0-9_-]` becomes a hyphen. Photo ids are UUIDs and survive that
 * untouched, which means this is a guard rather than a transformation: it
 * exists so that a future caller passing something stranger cannot strand
 * every upload, and so there is one place to put the rule and one test to
 * hold it.
 */
export function deduplicationKey(photoId: string): string {
  return `derive-${photoId}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

let client: Client | null = null;

function queue(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  /*
   * The regional endpoint, not the default one.
   *
   * QStash accounts live in a region and `qstash.upstash.io` resolves to
   * eu-central-1. A us-east-1 account publishing there is answered "user not
   * found in this region", which reads as a bad token rather than a wrong
   * address — and the integration sets `QSTASH_URL` to the right host
   * precisely so nobody has to know that.
   *
   * Left to the library's default when unset, which is correct for an account
   * that is in the default region.
   */
  const baseUrl = process.env.QSTASH_URL;
  client ??= new Client(baseUrl ? { token, baseUrl } : { token });
  return client;
}

/** Tests swap in a fake; nothing else should call this. */
export function __setQueueForTests(fake: Client | null): void {
  client = fake;
}

/**
 * Ask for one photo to be derived.
 *
 * Throws when the queue is configured and the publish fails. Returns
 * `not-configured` when there is no queue at all, which is a different thing
 * and is left for the caller to decide about.
 */
export async function publishDerive(photoId: string): Promise<PublishResult> {
  const client = queue();
  if (!client) return 'not-configured';

  const url = process.env.DERIVER_JOB_URL;
  if (!url) {
    // Configured to publish and given nowhere to publish to. Silence here
    // would be the worst of both: the queue looks live, and every photo is
    // stranded.
    throw new Error('QSTASH_TOKEN is set but DERIVER_JOB_URL is not');
  }

  await client.publishJSON({
    url,
    body: { photoId },
    /*
     * More attempts than the default three, and the reason is the shape of the
     * backoff rather than the count. QStash retries at 12s, 2m28s, 30m8s, then
     * 6h — so three attempts give up after half an hour, which is the wrong
     * side of "somebody uploaded photos and closed the app". The early
     * attempts are the ones that matter; the later ones cost nothing while
     * they wait.
     */
    retries: 5,
    /*
     * At-least-once delivery means the same photo can arrive twice, and the
     * deduplication window is ten minutes. This narrows the common case — a
     * client retrying `complete`, or a publish whose acknowledgement was lost
     * — to one delivery. It is not a guarantee, and the deriver does not rely
     * on it: `processPhoto` returns early on a photo that is already ready,
     * and the handler refuses a second delivery that overlaps the first.
     *
     * A hyphen, not a colon. QStash refuses a deduplication id containing one
     * — `{"error":"DeduplicationId cannot contain ':'"}` — and it refuses it
     * at publish time, which is inside the `try` in `complete`. So every
     * upload after this feature shipped ended the same way: the bytes reached
     * storage, `complete` threw, the row never got its `bytesAt`, the deriver
     * will not claim a row without one, and the photograph stayed 'pending'
     * forever while the client retried a request that could not ever succeed.
     * An album with a cover and nothing in it.
     *
     * `deduplicationKey` below is what keeps that from being expressible
     * again: the rule is in one function with a test against it, rather than
     * in a template literal nobody can see is wrong.
     */
    deduplicationId: deduplicationKey(photoId),
  });

  return 'published';
}
