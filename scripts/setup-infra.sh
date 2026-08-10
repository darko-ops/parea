#!/usr/bin/env bash
#
# Create the Neon project and the R2 bucket, and wire the secrets so they
# actually agree with each other.
#
#   ./scripts/setup-infra.sh
#
# Run it on a machine logged into Cloudflare and Neon — it uses your auth and
# creates things in your accounts. It is idempotent: an existing bucket or
# project is reused rather than clobbered, and nothing is ever deleted.
#
# One thing it cannot do, because it is dashboard-only: creating the R2 S3-API
# token. It stops and tells you.
#
# Pass --with-workers to also deploy the two Cloudflare Workers using the
# secrets it just generated, so they cannot disagree with the app.
#
# See docs/deploy.md for the rest, and docs/csam-runbook.md before this
# accepts a real photo from a real person.

set -euo pipefail

WITH_WORKERS=false
[ "${1:-}" = "--with-workers" ] && WITH_WORKERS=true

BUCKET="${R2_BUCKET:-parea}"
NEON_PROJECT="${NEON_PROJECT:-parea}"
ENV_FILE="apps/web/.env.local"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
die() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[ -f package.json ] || die "Run this from the repository root."

# --- preconditions ----------------------------------------------------------
# Checked up front rather than failing halfway through with half an
# infrastructure created.

bold "Checking you are logged in"

command -v npx >/dev/null || die "npx is required."

# `wrangler whoami` exits 0 when logged out and says so in its output, so the
# exit code is not the signal here.
if npx --yes wrangler@latest whoami 2>&1 | grep -qi "not authenticated"; then
  die "Not logged into Cloudflare. Run: npx wrangler login"
fi
echo "  cloudflare  ok"

if ! npx --yes neonctl@latest me >/dev/null 2>&1; then
  die "Not logged into Neon. Run: npx neonctl auth"
fi
echo "  neon        ok"

# --- database ---------------------------------------------------------------

bold "Neon project '$NEON_PROJECT'"

existing_project="$(npx --yes neonctl@latest projects list --output json 2>/dev/null \
  | python3 -c "
import json,sys
name = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
projects = data.get('projects', data) if isinstance(data, dict) else data
print(next((p['id'] for p in projects if p.get('name') == name), ''))
" "$NEON_PROJECT")"

if [ -n "$existing_project" ]; then
  echo "  reusing $existing_project"
  project_id="$existing_project"
else
  project_id="$(npx --yes neonctl@latest projects create --name "$NEON_PROJECT" --output json \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['project']['id'])")"
  echo "  created $project_id"
fi

database_url="$(npx --yes neonctl@latest connection-string --project-id "$project_id")"
[ -n "$database_url" ] || die "Could not get a connection string from Neon."

# --- object storage ---------------------------------------------------------

bold "R2 bucket '$BUCKET'"

if npx --yes wrangler@latest r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "  reusing existing bucket"
else
  npx --yes wrangler@latest r2 bucket create "$BUCKET"
  echo "  created"
fi

# Download manifests are written under this prefix and referenced by a
# 15-minute token. Without an expiry they accumulate forever — small, but
# unbounded, and nothing else ever deletes them.
bold "Lifecycle rule on tmp/manifest/"
if npx --yes wrangler@latest r2 bucket lifecycle add "$BUCKET" \
      expire-manifests tmp/manifest/ --expire-days 1 >/dev/null 2>&1; then
  echo "  set to expire after 1 day"
else
  warn "  could not add it (it may already exist) — check:"
  warn "    npx wrangler r2 bucket lifecycle list $BUCKET"
fi

# --- secrets ----------------------------------------------------------------
#
# Generated together, once, because the failure mode when they disagree is
# silent: the app signs with one value, a Worker verifies with another, and
# every download or every thumbnail 404s with nothing in any log saying why.

bold "Secrets"

if [ -f "$ENV_FILE" ] && grep -q '^SESSION_SECRET=.\+' "$ENV_FILE" 2>/dev/null; then
  warn "  $ENV_FILE already has secrets — leaving them alone."
  warn "  Delete it first if you want fresh ones."
  session_secret="$(grep '^SESSION_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
  manifest_secret="$(grep '^MANIFEST_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
  image_secret="$(grep '^IMAGE_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
else
  session_secret="$(openssl rand -base64 32)"
  manifest_secret="$(openssl rand -base64 32)"
  image_secret="$(openssl rand -base64 32)"

  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<EOF
# Written by scripts/setup-infra.sh. Not committed.
SESSION_SECRET=$session_secret
MANIFEST_SECRET=$manifest_secret
IMAGE_SECRET=$image_secret

DATABASE_URL=$database_url

R2_BUCKET=$BUCKET
# From the Cloudflare dashboard — see the next steps printed below.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# Filled in once the Workers are deployed.
ZIP_BASE_URL=
IMAGE_BASE_URL=

SAFETY_CONTACT_EMAIL=

# Sign-in codes. Accounts are optional; without these nobody can claim one,
# and in production the mailer refuses rather than dropping codes silently.
MAIL_API_URL=
MAIL_API_KEY=
MAIL_FROM=

# Only needed once the app exists. Until they are set, the two .well-known
# files 404 and every tapped link opens a browser on a phone that has the app
# installed — which looks exactly like not having it installed.
APPLE_TEAM_ID=
ANDROID_CERT_FINGERPRINTS=

APP_URL=http://localhost:3000
EOF
  chmod 600 "$ENV_FILE"
  echo "  wrote $ENV_FILE (chmod 600)"
fi

# --- schema -----------------------------------------------------------------

bold "Migrations"
DATABASE_URL="$database_url" npm run db:migrate --silent

# The spoken-code door does not open until this runs: creation claims from the
# pool, and an empty pool silently yields no code.
bold "Seeding the code pool"
DATABASE_URL="$database_url" npx tsx services/deriver/src/jobs.ts seed-codes

# --- workers ----------------------------------------------------------------
#
# Deployed from here, with the secrets generated above, because a human copying
# two base64 strings between three places is exactly how they come to disagree
# — and a mismatch is a 404 with nothing in any log to explain it.

deploy_worker() {
  local dir="$1" secret_name="$2" secret_value="$3"
  ( cd "$dir" || exit 1
    printf '%s' "$secret_value" \
      | npx --yes wrangler@latest secret put "$secret_name" >/dev/null 2>&1
    npx --yes wrangler@latest deploy 2>&1 \
      | grep -oE 'https://[A-Za-z0-9._-]+workers\.dev' | head -1
  )
}

set_env() {
  local key="$1" value="$2"
  [ -n "$value" ] || return 0
  # Only fills a blank; never overwrites something already set by hand.
  sed -i.bak "s|^${key}=$|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
}

if [ "$WITH_WORKERS" = true ]; then
  bold "Deploying Workers"
  image_url="$(deploy_worker services/image-worker IMAGE_SECRET "$image_secret" || true)"
  zip_url="$(deploy_worker services/zip-worker MANIFEST_SECRET "$manifest_secret" || true)"

  if [ -n "$image_url" ] && [ -n "$zip_url" ]; then
    set_env IMAGE_BASE_URL "$image_url"
    set_env ZIP_BASE_URL "$zip_url"
    echo "  image  $image_url"
    echo "  zip    $zip_url"
  else
    warn "  could not read the deployed URLs from wrangler output"
    warn "  set IMAGE_BASE_URL and ZIP_BASE_URL in $ENV_FILE by hand"
  fi
fi

# --- what is left -----------------------------------------------------------

bold ""
bold "Done."
echo

if [ "$WITH_WORKERS" != true ]; then
  echo "Workers were not deployed. Re-run with --with-workers, or deploy them"
  echo "by hand and put the two URLs into $ENV_FILE."
  echo
fi

cat <<TEXT
Left to do, and it is dashboard-only: the R2 S3-API token.
  Cloudflare -> R2 -> Manage API tokens -> Create, Object Read & Write scoped
  to '$BUCKET'. Put the account id, key id and secret into $ENV_FILE.

Then:
  npm run dev --workspace @parea/web      and check /api/health

Ingest, for a deployment nobody else can reach:
  CSAM_SCANNER=disabled PAREA_ALLOW_UNSCANNED=private-deployment \\
    npm run watch --workspace @parea/deriver

It starts, and says on every boot that uploads are going out unchecked. That
is only true while you are the only person holding a link. Before anyone else
has one, get a scanning provider - docs/csam-runbook.md.
TEXT
