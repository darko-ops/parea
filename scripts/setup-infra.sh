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

# neonctl asks "What organization would you like to use?" when the account
# belongs to one, and every call below captures stdout — so the question is
# written into the variable instead of to the terminal, and the script waits
# forever on a prompt nobody can see. Worse when it does not wait: the captured
# prompt text is a non-empty string, so the guard below passes and the failure
# arrives later as a JSON parse error pointing at the wrong line.
#
# So resolve it once, up front, and pass it explicitly from then on. Set
# NEON_ORG to override; an account with no organization needs no flag at all.
if [ -z "${NEON_ORG:-}" ]; then
  orgs_json="$(npx --yes neonctl@latest orgs list --output json 2>/dev/null || true)"
  NEON_ORG="$(printf '%s' "$orgs_json" \
    | python3 -c "
import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
orgs = data.get('organizations', data) if isinstance(data, dict) else data
if not isinstance(orgs, list) or len(orgs) != 1:
    print(''); raise SystemExit
print(orgs[0].get('id', ''))
")"

  # More than one, or none found and one is needed: say so here rather than
  # letting it become an invisible prompt three commands later.
  if [ -z "$NEON_ORG" ] && printf '%s' "$orgs_json" | grep -q '"id"'; then
    warn "  Your Neon account has more than one organization, so which to use"
    warn "  cannot be guessed. List them and re-run with the one you want:"
    warn "    npx neonctl orgs list"
    die "    NEON_ORG=org-… ./scripts/setup-infra.sh"
  fi
fi
[ -n "${NEON_ORG:-}" ] && echo "  org $NEON_ORG"

# Unquoted on purpose: an empty NEON_ORG has to vanish rather than become an
# empty argument, and organization ids contain no spaces.
neon() { npx --yes neonctl@latest "$@" ${NEON_ORG:+--org-id "$NEON_ORG"}; }

# Captured before parsing, and `|| true` on purpose. Piping neonctl straight
# into python looks tidier and is a trap: under `set -o pipefail` a neonctl
# failure fails the whole substitution, `set -e` exits, and the graceful
# fallback below never runs — the script just stops, printing nothing at all.
projects_json="$(neon projects list --output json 2>/dev/null || true)"
[ -n "$projects_json" ] || die "Could not list Neon projects. Check: npx neonctl projects list"

existing_project="$(printf '%s' "$projects_json" \
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
  create_json="$(neon projects create --name "$NEON_PROJECT" --output json 2>/dev/null || true)"
  project_id="$(printf '%s' "$create_json" \
    | python3 -c "
import json,sys
try:
    print(json.load(sys.stdin)['project']['id'])
except Exception:
    print('')
")"
  [ -n "$project_id" ] || die "Could not create the Neon project. Run it by hand to see why:
  npx neonctl projects create --name $NEON_PROJECT${NEON_ORG:+ --org-id $NEON_ORG}"
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
#
# `--force` is load-bearing: `lifecycle add` asks for confirmation by default,
# and this used to send that prompt to /dev/null, so the script sat waiting on
# an invisible question. Whatever happened next was swallowed by a warning that
# said the rule "may already exist" — which read like reassurance and was never
# once checked.
bold "Lifecycle rule on tmp/manifest/"
if npx --yes wrangler@latest r2 bucket lifecycle list "$BUCKET" 2>/dev/null \
    | grep -q 'expire-manifests'; then
  echo "  already set"
elif npx --yes wrangler@latest r2 bucket lifecycle add "$BUCKET" \
      expire-manifests tmp/manifest/ --expire-days 1 --force >/dev/null 2>&1; then
  echo "  set to expire after 1 day"
else
  warn "  FAILED — and nothing else ever deletes these, so manifests will"
  warn "  accumulate forever. Set it by hand:"
  warn "    npx wrangler r2 bucket lifecycle add $BUCKET \\"
  warn "      expire-manifests tmp/manifest/ --expire-days 1 --force"
fi

# --- secrets ----------------------------------------------------------------
#
# Generated together, once, because the failure mode when they disagree is
# silent: the app signs with one value, a Worker verifies with another, and
# every download or every thumbnail 404s with nothing in any log saying why.

bold "Secrets"

# `|| true` because a missing line is an answer, not an error. Without it,
# `set -o pipefail` turns grep's exit 1 into the script exiting 1 with nothing
# printed — which is what happened if the file was missing any of the three.
from_env() { grep "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

if [ -f "$ENV_FILE" ] && grep -q '^SESSION_SECRET=.\+' "$ENV_FILE" 2>/dev/null; then
  warn "  $ENV_FILE already has secrets — leaving them alone."
  warn "  Delete it first if you want fresh ones."
  session_secret="$(from_env SESSION_SECRET)"
  manifest_secret="$(from_env MANIFEST_SECRET)"
  image_secret="$(from_env IMAGE_SECRET)"

  # The trap this whole section exists to prevent, arriving by the back door.
  # The web app falls back to SESSION_SECRET when MANIFEST_SECRET or
  # IMAGE_SECRET is unset; a Worker has no such fallback. So a blank one here
  # deploys a Worker that verifies against nothing, and every download — or
  # every thumbnail — 404s with nothing in any log to explain it.
  #
  # It is an easy state to be in: the README says to copy .env.example and set
  # SESSION_SECRET, and .env.example carries the other two as empty lines. The
  # guard above sees a session secret and takes this branch.
  for named in "SESSION_SECRET=$session_secret" "MANIFEST_SECRET=$manifest_secret" \
               "IMAGE_SECRET=$image_secret"; do
    [ -n "${named#*=}" ] || die "${named%%=*} is blank in $ENV_FILE.
Set all three, or delete the file and re-run so they are generated together."
  done
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

# Named on /terms and /privacy. Production refuses to look finished without
# them: the pages render a visible placeholder and /api/health reports both.
LEGAL_ENTITY=
LEGAL_JURISDICTION=

# Sign-in codes. Accounts are optional; without these nobody can claim one,
# and in production the mailer refuses rather than dropping codes silently.
# resend | postmark | sendgrid | mailgun (default resend). MAIL_API_URL only
# to override the endpoint, and for mailgun, whose path carries the domain.
# Check with: npm run mail:test -- you@example.com
MAIL_PROVIDER=
MAIL_API_KEY=
MAIL_FROM=
MAIL_API_URL=

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
  local dir="$1" secret_name="$2" secret_value="$3" out
  ( cd "$dir" || exit 1

    # stderr is deliberately not silenced. A `secret put` that fails, followed
    # by a `deploy` that succeeds, is exactly the silent mismatch this function
    # was written to avoid — and swallowing wrangler's complaint is how it
    # would happen without anyone noticing.
    printf '%s' "$secret_value" \
      | npx --yes wrangler@latest secret put "$secret_name" >/dev/null || exit 1

    if ! out="$(npx --yes wrangler@latest deploy 2>&1)"; then
      printf '%s\n' "$out" >&2
      exit 1
    fi

    # `|| true` only here: a deploy onto a custom domain prints no workers.dev
    # URL, and that is a success with nothing to extract, not a failure.
    printf '%s' "$out" \
      | grep -oE 'https://[A-Za-z0-9._-]+workers\.dev' | head -1 || true
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
  image_url="$(deploy_worker services/image-worker IMAGE_SECRET "$image_secret")" \
    || die "image-worker failed — see the wrangler output above. Nothing was written to $ENV_FILE."
  zip_url="$(deploy_worker services/zip-worker MANIFEST_SECRET "$manifest_secret")" \
    || die "zip-worker failed — see the wrangler output above. Nothing was written to $ENV_FILE."

  if [ -n "$image_url" ] && [ -n "$zip_url" ]; then
    set_env IMAGE_BASE_URL "$image_url"
    set_env ZIP_BASE_URL "$zip_url"
    echo "  image  $image_url"
    echo "  zip    $zip_url"
  else
    # Expected if the Workers are on custom domains: there is no workers.dev
    # URL to read, and the custom hostnames are the ones you want anyway.
    warn "  no workers.dev URL in the output — set IMAGE_BASE_URL and"
    warn "  ZIP_BASE_URL in $ENV_FILE by hand (https://img.<domain>,"
    warn "  https://zip.<domain> if you added custom domains)"
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
