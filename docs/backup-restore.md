# Backups and restoring

What can be recovered, from where, and how long it takes. Security review M16.

## The database (Neon)

**Point-in-time restore.** Neon keeps the write-ahead log for the project's
history retention window and can restore, or branch from, any moment inside
it. Parea is on the Launch plan with the window set to **1 day** (project
Settings → Storage → history retention). The privacy policy says the database
keeps one day of history, so change that sentence in the same change as the
setting.

**Snapshot branches before migrations.** When `NEON_API_KEY` and
`NEON_PROJECT_ID` are set in Vercel, every production deploy that has a
migration to apply first takes a branch named `pre-migrate-<time>-<sha>`
(`scripts/migrate-on-deploy.mjs`). Every production deploy prunes them to the
newest three and to at most seven days old, which is what the privacy policy
promises for them. Without those two
variables the deploy logs a warning and relies on point-in-time restore.

**An encrypted daily copy, off Neon.** Once a day the hourly job on
`parea-jobs` runs `pg_dump` of production, encrypts it with `age` to a public
key, and puts it in its own R2 bucket, `parea-backups`
(`services/deriver/src/backup.ts`). It survives losing the Neon account.

- **Encrypted before it leaves the machine.** The private key is on no server:
  it is in the owner's password manager. Cloudflare, and anyone with the
  bucket's key, holds ciphertext.
- **Its own token**, scoped to `parea-backups` only (`BACKUP_R2_*`). R2 has no
  write-only permission, so the bucket carries a **lock rule** instead: nothing
  under `db/` can be deleted or overwritten for six days, by any key.
- **Kept seven days**, by a lifecycle rule that deletes each copy seven days
  after it was written. The privacy page says the backup is kept at most a
  week, so a longer retention changes that sentence in the same change.
- **Watched.** `job_run` row `backup`; `/api/cron/jobs-heartbeat` alerts
  (Sentry and `OPS_ALERT_EMAIL`) when no copy has succeeded for 26 hours,
  including when the secrets are missing. The hub lists it on Experience.

#### Setting it up (once)

1. The key pair, on your own machine — `brew install age`, then
   `age-keygen -o parea-backup.key`. It prints `Public key: age1…`. Put the
   whole file's contents in the password manager as "Parea backup key", then
   `rm parea-backup.key`. Without it no backup can ever be read.
2. The bucket, its expiry and its lock:
   ```
   npx wrangler r2 bucket create parea-backups
   npx wrangler r2 bucket lifecycle add parea-backups expire-7d db/ --expire-days 7 -y
   npx wrangler r2 bucket lock add parea-backups lock-6d db/ --retention-days 6 -y
   ```
3. The token: Cloudflare → R2 → Manage API tokens → Create → **Object Read &
   Write**, applied to **`parea-backups` only**. Copy the access key ID and
   secret.
4. The secrets, on the jobs app only (the deriver does not need them), then
   point the scheduled machine at them and at the new image:
   ```
   flyctl secrets set --stage -a parea-jobs \
     BACKUP_R2_BUCKET=parea-backups \
     BACKUP_AGE_RECIPIENT=age1PASTE_HERE \
     BACKUP_R2_ACCESS_KEY_ID=PASTE_HERE \
     BACKUP_R2_SECRET_ACCESS_KEY=PASTE_HERE
   ```
   then build, push and `flyctl machine update` as `fly.jobs.toml` says, and
   `flyctl machine start` it once. `flyctl logs -a parea-jobs` shows
   `backup: db/<time>Z.dump.age (<bytes> bytes)`.

#### Restoring from it

When Neon itself is the problem — otherwise the branches below are faster.

1. The newest copy: `npx wrangler r2 object get parea-backups/db/<time>Z.dump.age --remote --file dump.age`
   (`npx wrangler r2 object list parea-backups --prefix db/` — or the dashboard — lists them).
2. Decrypt, with the key from the password manager in a file for the moment:
   `age --decrypt -i parea-backup.key -o parea.dump dump.age`, then delete the key file.
3. A database to restore into — a new Neon project, or any Postgres 18 — and
   `pg_restore --no-owner --no-acl --dbname "$NEW_DATABASE_URL" parea.dump`.
4. Point `DATABASE_URL` at it everywhere ([access.md](access.md) lists where),
   and delete `dump.age` and `parea.dump` once it is running: they are the
   whole database in the clear.

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
branch. Then do the same from the newest off-site copy — download, decrypt,
`pg_restore` into a scratch database, count, and delete the database and both
files. Write the date and how long each took here.

With the Neon CLI (`npx neonctl`, signed in once):

```
npx neonctl branches create --project-id still-dust-88337211 \
  --name restore-drill-$(date -u +%Y%m%d) --parent <UTC timestamp> --type read_only
npx neonctl connection-string restore-drill-<date> --project-id still-dust-88337211
#   … connect and count, without printing the connection string anywhere …
npx neonctl branches delete restore-drill-<date> --project-id still-dust-88337211
```

A read-only branch cannot be written to by mistake, and deleting it keeps the
copy of since-deleted data from outliving the one-day window.

| Date | Restored to | Took | Notes |
|---|---|---|---|
| 2026-09-30 | 1 hour back, and 21:50 UTC (before migration 0054) | ~11 s to branch, count and delete | Project `parea-prod` (`still-dust-88337211`), history 1 day. Counts matched production (3 accounts, 20 actors, 27 events, 240 photos). The 21:50 copy showed 54 migrations against production's 55, proving it was the earlier state. Read-only branches, deleted after. |
| 2026-10-10 | First off-site copy, `db/2026-10-10T00-48Z.dump.age` | ~40 s for the jobs run; seconds to download and decrypt | 3.2 MB encrypted, 3.2 MB decrypted, a valid `pg_dump` custom archive (`PGDMP` header). Downloaded and decrypted only, not yet `pg_restore`d into a scratch database: do that at the next drill. |
