#!/usr/bin/env bash
# secrets/doppler — SVCOS Doppler mode (.doppler.yaml). Default profile. Verified 2026-09-07.
# Every SVCOS invocation here is exactly what genesis.sh ran before the adapter split (design G7).
#
# Probes never fail open: a Doppler failure other than "secret not found" is fatal, because
# treating it as "not configured" would re-run init or convex-setup and duplicate resources.

secrets_doppler_capabilities() {
  jq -cn --arg mode doppler '{kind:"secrets", name:"doppler", implemented:true, verified:true, secrets_mode:$mode,
    needs_env:[], needs_cmd:["doppler"],
    supports:["bootstrap","has","get","set","sync_local","ci_token","export_env"]}'
}

secrets_doppler_mode() { printf doppler; }

secrets_doppler_step_name() {
  case "$1" in
    bootstrap) printf doppler-bootstrap ;;
    sync_local) printf doppler-sync ;;
    ci_token) printf doppler-ci-token ;;
    *) printf 'doppler-%s' "$1" ;;
  esac
}

secrets_doppler_bootstrapped() { [ -f .doppler.yaml ]; }

# secrets_doppler_bootstrap NAME — create the Doppler project (dev, prd) and pin the repo to dev.
secrets_doppler_bootstrap() {
  local name="$1"
  # Local runtime: the worker account's Doppler CLI login is the credential (design §8.1).
  # Cloud sandboxes inject DOPPLER_TOKEN per run instead.
  if [ -z "${DOPPLER_TOKEN:-}" ] && ! doppler me >/dev/null 2>&1; then
    printf 'MISSING_ENV DOPPLER_TOKEN (or a Doppler CLI login for this account)\n' >&2
    exit 2
  fi
  run_svcos doppler-bootstrap node scripts/setup.mjs doppler-bootstrap --project-name="$name"
}

# secrets_doppler_get KEY — Doppler dev first, then .env.local (Convex writes there before the
# sync step pushes it up); empty only when neither has it. Other Doppler errors are fatal.
secrets_doppler_get() {
  local value=""
  if [ -f .doppler.yaml ]; then
    doppler_check
    value=$(doppler_get "$1")
  fi
  [ -n "$value" ] || value=$(env_local_get "$1")
  printf '%s' "$value"
}

secrets_doppler_has() { [ -n "$(secrets_doppler_get "$1")" ]; }

# secrets_doppler_has_remote KEY — in Doppler dev itself (not .env.local).
secrets_doppler_has_remote() {
  doppler_check
  [ -n "$(doppler_get "$1")" ]
}

secrets_doppler_set() {
  doppler_check
  doppler secrets set "$1=$2" --config dev --silent >/dev/null
}

# The keys the backend writes to .env.local that Doppler must carry (SVCOS install "Doppler
# post-init"). Nothing else in .env.local is synced: Vercel's VERCEL_OIDC_TOKEN and other local
# artefacts must not land in the secrets broker.
SECRETS_DOPPLER_SYNC_KEYS="CONVEX_DEPLOYMENT NEXT_PUBLIC_CONVEX_URL NEXT_PUBLIC_CONVEX_SITE_URL" # pragma: allowlist secret

# secrets_doppler_synced — Doppler dev already holds every Convex key .env.local has.
secrets_doppler_synced() {
  local key
  for key in $SECRETS_DOPPLER_SYNC_KEYS; do
    [ -n "$(env_local_get "$key")" ] || continue
    secrets_doppler_has_remote "$key" || return 1
  done
  return 0
}

# secrets_doppler_sync_local — push only the Convex keys from .env.local to Doppler dev.
secrets_doppler_sync_local() {
  local key value pushed=()
  for key in $SECRETS_DOPPLER_SYNC_KEYS; do
    value=$(env_local_get "$key")
    [ -n "$value" ] || continue
    secrets_doppler_set "$key" "$value"
    pushed+=("$key")
  done
  jq -cn --arg keys "${pushed[*]}" '{success:true, pushed:($keys | split(" ") | map(select(length > 0)))}'
}

# secrets_doppler_has_ci_token OWNER/REPO — the CI token already lives in GitHub Actions secrets.
secrets_doppler_has_ci_token() {
  gh secret list --repo "$1" --json name -q '.[].name' 2>/dev/null | grep -qx DOPPLER_TOKEN
}

# The service-token name SVCOS's doppler-create-ci-token uses (scripts/setup.mjs).
SECRETS_DOPPLER_CI_TOKEN_NAME="github-actions-ci" # pragma: allowlist secret

# secrets_doppler_ci_token OWNER/REPO — revoke stale tokens of the same name (SVCOS creates the
# token before `gh secret set`, so every failed attempt leaked a live one), then create and push.
secrets_doppler_ci_token() {
  local slug
  doppler_check
  while IFS= read -r slug; do
    [ -n "$slug" ] || continue
    doppler configs tokens revoke "$slug" --config dev --yes >/dev/null 2>&1 || \
      doppler configs tokens revoke "$slug" --config dev >/dev/null
    log "${STAGE:-SECRETS}" doppler-ci-token-revoke passed slug="$slug"
  done < <(doppler configs tokens --config dev --json 2>/dev/null | jq -r --arg n "$SECRETS_DOPPLER_CI_TOKEN_NAME" '.[] | select(.name==$n) | .slug')
  # The product has origin and upstream remotes; tell gh which repo without patching SVCOS.
  run_svcos doppler-ci-token env GH_REPO="$1" node scripts/setup.mjs doppler-create-ci-token
}

# secrets_doppler_export_env [CONFIG] — dotenv lines for a config (dev by default).
secrets_doppler_export_env() {
  doppler secrets download --no-file --format env --config "${1:-dev}"
}
