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
# Two things it cannot do, both dashboard-only, and it stops and tells you:
# creating the R2 S3-API token, and choosing a child-safety scanning provider.
#
# See docs/deploy.md for the rest, and docs/csam-runbook.md before this
# accepts a real photo from a real person.

set -euo pipefail

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

# --- what is left -----------------------------------------------------------

cat <<EOF

$(bold "Done. Three things remain, and none of them can be scripted.")

1. R2 S3-API token — dashboard only.
   Cloudflare → R2 → Manage API tokens → Create, with Object Read & Write
   scoped to '$BUCKET'. Put the account id, key id and secret into
   $ENV_FILE.

2. Deploy the Workers, using the secrets just generated so they match:

     cd services/image-worker
     echo "$image_secret" | npx wrangler secret put IMAGE_SECRET
     npx wrangler deploy

     cd ../zip-worker
     echo "$manifest_secret" | npx wrangler secret put MANIFEST_SECRET
     npx wrangler deploy

   Then put the two deployed URLs into $ENV_FILE as IMAGE_BASE_URL and
   ZIP_BASE_URL.

3. A child-safety scanning provider, before this accepts a photo from anyone
   who is not you. Ingest fails closed without one, so uploads will stall
   rather than leak — safe, and broken. docs/csam-runbook.md lists what has
   to be true first, including a named human who receives alerts.

Then: npm run dev --workspace @parea/web, and check /api/health.
EOF
