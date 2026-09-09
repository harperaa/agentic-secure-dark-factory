#!/usr/bin/env bash
# DEPLOY_DEV stage: dev deploy through the hosting adapter, idempotent.
# Input on stdin: {"name":..., "github_owner":..., "admin_email":..., "providers": {...}}
# `providers` is the spec's providers block; when absent the default profile is used.
# Runs inside the product repository (Machinist repository path) or is called by genesis.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=../providers/load.sh
source "$SCRIPT_DIR/../providers/load.sh"

STAGE=DEPLOY_DEV
require_cmd node npx gh jq git

IN=$(cat)
name=$(spec_get "$IN" name)
owner=$(spec_get "$IN" github_owner)
email=$(spec_get "$IN" admin_email)
providers_load "$(jq -c '{providers: (.providers // {profile:"default"})}' <<<"$IN")"
providers_gate

[ -f package.json ] || die "not in a product repository (no package.json)"
hosting_is_linked || die "NEEDS_HUMAN reason=hosting-not-linked (run genesis first)"

# check-tools has no success field: assert on what it actually reports.
log $STAGE check-tools started
run_svcos check-tools node scripts/deploy.mjs check-tools
missing=$(jq -r '(.missing // []) | join(",")' <<<"$SVCOS_JSON")
[ -z "$missing" ] || die "ERROR step=check-tools reason=missing-tools tools=$missing"
[ "$(jq -r '.tools.ghAuth // false' <<<"$SVCOS_JSON")" = "true" ] || die "ERROR step=check-tools reason=gh-not-authenticated"
log $STAGE check-tools passed

step=$(hosting_step_name set_env)
log $STAGE "$step" started
hosting_set_env dev
log $STAGE "$step" passed

step=$(hosting_step_name deploy)
log $STAGE "$step" started
hosting_deploy
deploy_json="$SVCOS_JSON"
url=$(json_field "$deploy_json" url)
dashboard=$(json_field "$deploy_json" dashboardUrl)
[ -n "$url" ] || die "hosting deploy returned no url: $deploy_json"
log $STAGE "$step" passed url="$url"

# The summary must not record "(not configured)" for values the product needs to run; a blank
# here means an earlier step silently failed, so stop rather than report status=ready.
repo_url=$(scm_repo_url "$owner" "$name")
convex_url=$(backend_url)
[ -n "$convex_url" ] || die "ERROR step=write-summary reason=missing-setting key=NEXT_PUBLIC_CONVEX_URL"
convex_site_url=${convex_url/.convex.cloud/.convex.site}
frontend_api=$(secrets_get NEXT_PUBLIC_CLERK_FRONTEND_API_URL)
[ -n "$frontend_api" ] || die "ERROR step=write-summary reason=missing-setting key=NEXT_PUBLIC_CLERK_FRONTEND_API_URL"

log $STAGE write-summary started
node scripts/deploy.mjs write-summary --deploy-type="dev" \
  --vercel-url="$url" --dashboard-url="$dashboard" --repo-url="$repo_url" \
  --convex-prod-url="$convex_url" --convex-site-url="$convex_site_url" \
  --frontend-api-url="$frontend_api" --site-name="$name" --admin-email="$email" \
  --google-oauth="deferred" \
  --completed-steps="GitHub repo created,Vercel project linked,Vercel env vars set,Deployed to Vercel" \
  --skipped-steps="Clerk production (run /deploy-to-prod),Google OAuth (run /deploy-to-prod),Stripe billing (run /deploy-to-prod)" >/dev/null
git add docs/DEPLOYMENT-DEV.md 2>/dev/null || true
git diff --cached --quiet || git -c user.name="${GIT_AUTHOR_NAME:-factory}" -c user.email="${GIT_AUTHOR_EMAIL:-$email}" \
  commit -q -m "docs: dev deployment summary"
log $STAGE write-summary passed

printf 'DEPLOY_RESULT status=ready url=%s dashboard=%s\n' "$url" "$dashboard"
