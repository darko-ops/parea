# Backups and restoring

What can be recovered, from where, and how long it takes. Security review M16.

## The database (Neon)

**Point-in-time restore.** Neon keeps the write-ahead log for the project's
history retention window and can restore, or branch from, any moment inside
it. The window depends on the plan — a few hours on the free plan, days on a
paid one — and it is set under the project's Settings → Storage. The privacy
policy promises that deleted records are gone after "a few hours", so if the
window is lengthened, change that sentence in the same change.

**Snapshot branches before migrations.** When `NEON_API_KEY` and
`NEON_PROJECT_ID` are set in Vercel, every production deploy that has a
migration to apply first takes a branch named `pre-migrate-<time>-<sha>`
(`scripts/migrate-on-deploy.mjs`), keeping the newest three. Without those two
variables the deploy logs a warning and relies on point-in-time restore.

**No off-site copy yet.** Everything above lives inside Neon. A scheduled
`pg_dump` to storage Neon does not control would survive losing the Neon
account itself — but it also keeps deleted data for as long as the dump is
kept, which the privacy policy does not currently allow. That is a decision to
make, not a default to switch on: pick a retention, update the policy, then add
the dump to the hourly job.

### Restoring

1. In Neon, create a branch from production at the moment before the damage
   (Branches → Create branch → "Past data"), or use a `pre-migrate-*` branch.
2. Check it: connect with `psql` and look at what went wrong.
3. Either copy the damaged rows back into production, or — for a whole-database
   loss — use Neon's "Restore" on the main branch from that point, which keeps
   the old state as a backup branch.
4. If code had changed the schema, deploy the matching commit (through git)
   before or with the restore.

## Photos (Cloudflare R2)

R2 does not keep versions of objects. A deleted or overwritten photo is gone.
What protects them:

- Nothing in the product overwrites an original: keys are random, and
  derivatives are separate objects.
- Deleting a photo hides it at once and destroys the file 30 days later (the
  hourly job's purge). So damage done by *us* — a bad deploy or job deleting
  rows — is recoverable for 30 days by clearing `deleted_at`. This is not a
  service offered to people: the privacy policy says deleted photos are not
  restored on request, and that stays true.
- Only the web app, the deriver and the jobs machine hold R2 write keys
  ([access.md](access.md)).

Lifecycle rules on the bucket (`wrangler r2 bucket lifecycle list parea`):
download manifests expire after a day, moment staging uploads after a day, and
incomplete multipart uploads after seven.

## Configuration

Vercel, Fly and Worker secrets are not backed up anywhere — by design, they
cannot be read back. Losing them means rotating them, which
[access.md](access.md) lists.

## Practise

Once a quarter, and after any change to the above: branch production from an
hour ago, connect to it, count the rows in `photo` and `account`, and delete the
branch. Write the date and how long it took here.

| Date | Restored to | Took | Notes |
|---|---|---|---|
| | | | |
