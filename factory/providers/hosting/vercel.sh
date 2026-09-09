#!/usr/bin/env bash
# hosting/vercel — Vercel via the CLI and SVCOS deploy.mjs. Default profile. Verified 2026-09-07.
# Invocations are exactly what genesis.sh and deploy-dev.sh ran before the adapter split (design G7).

hosting_vercel_capabilities() {
  jq -cn '{kind:"hosting", name:"vercel", implemented:true, verified:true,
    needs_env:["VERCEL_SCOPE"], needs_cmd:["npx"],
    supports:["link","is_linked","write_config","set_env","deploy","promote"]}'
}

hosting_vercel_step_name() {
  case "$1" in
    link) printf vercel-link ;;
    config) printf vercel-config ;;
    set_env) printf vercel-env ;;
    deploy) printf vercel-deploy ;;
    *) printf 'vercel-%s' "$1" ;;
  esac
}

hosting_vercel_is_linked() { [ -f .vercel/project.json ]; }

# hosting_vercel_link NAME — create the project if needed, link the checkout, connect git.
hosting_vercel_link() {
  local name="$1"
  npx vercel project add "$name" --scope="$VERCEL_SCOPE" >/dev/null 2>&1 || true
  npx vercel link --yes --project="$name" --scope="$VERCEL_SCOPE"
  npx vercel git connect "$(git remote get-url origin)" --yes --scope="$VERCEL_SCOPE" || \
    log "${STAGE:-HOSTING}" vercel-git-connect failed reason=non-fatal
}

# _hosting_vercel_build_command MODE — the buildCommand the active secrets mode needs, or empty.
_hosting_vercel_build_command() {
  [ "$1" = "doppler" ] && printf 'node scripts/vercel-prebuild.mjs && npm run build'
  return 0
}

# hosting_vercel_config_current MODE — vercel.json already has the framework and build command
# for this mode and no longer re-installs modules; nothing to write.
hosting_vercel_config_current() {
  local want
  [ -f vercel.json ] || return 1
  want=$(_hosting_vercel_build_command "$1")
  jq -e --arg want "$want" '
    (.framework == "nextjs")
    and ((.buildCommand // "") | test("modules\\.mjs install") | not)
    and (if $want == "" then true else .buildCommand == $want end)' vercel.json >/dev/null 2>&1
}

# hosting_vercel_write_config MODE — vercel.json for the active secrets mode (deploy-to-dev step 3),
# merged over whatever the product already has so operator keys (headers, crons, regions) survive.
# The template's own vercel.json re-installs modules at build time so the demo site renders; a
# product has its modules committed, so that command must go or the Vercel build fails.
hosting_vercel_write_config() {
  local want tmp
  want=$(_hosting_vercel_build_command "$1")
  tmp=$(mktemp)
  if [ -n "$want" ]; then
    jq --arg want "$want" '. + {"$schema":"https://openapi.vercel.sh/vercel.json", framework:"nextjs", buildCommand:$want}' \
      "$([ -f vercel.json ] && printf vercel.json || printf /dev/null)" > "$tmp" 2>/dev/null \
      || jq -n --arg want "$want" '{"$schema":"https://openapi.vercel.sh/vercel.json", framework:"nextjs", buildCommand:$want}' > "$tmp"
  else
    jq '. + {framework:"nextjs"} | del(.buildCommand)' "$([ -f vercel.json ] && printf vercel.json || printf /dev/null)" > "$tmp" 2>/dev/null \
      || jq -n '{framework:"nextjs"}' > "$tmp"
  fi
  mv "$tmp" vercel.json
}

# hosting_vercel_set_env ENV — dev: SVCOS vercel-env-dev (Doppler-aware).
hosting_vercel_set_env() {
  case "$1" in
    dev) run_svcos vercel-env-dev node scripts/deploy.mjs vercel-env-dev ;;
    *) die "hosting/vercel: set_env supports dev only in this milestone (got $1)" ;;
  esac
}

# hosting_vercel_deploy — SVCOS vercel-deploy; leaves {url, dashboardUrl} in SVCOS_JSON.
hosting_vercel_deploy() {
  run_svcos vercel-deploy node scripts/deploy.mjs vercel-deploy
}

# hosting_vercel_promote URL — promote a deployment to production.
hosting_vercel_promote() { npx vercel promote "$1" --yes --scope="$VERCEL_SCOPE"; }
