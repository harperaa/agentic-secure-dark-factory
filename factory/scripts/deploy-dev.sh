#!/usr/bin/env bash
# DEPLOY_DEV stage: SVCOS deploy.mjs chain against dev Clerk + dev Convex, idempotent.
# Input on stdin: {"name":..., "github_owner":..., "vercel_scope":..., "admin_email":...}
# Runs inside the product repository (Machinist repository path) or is called by genesis.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

STAGE=DEPLOY_DEV
require_cmd node npx gh jq git

IN=$(cat)
name=$(spec_get "$IN" name)
owner=$(spec_get "$IN" github_owner)
email=$(spec_get "$IN" admin_email)

[ -f package.json ] || die "not in a product repository (no package.json)"
[ -f .vercel/project.json ] || die "NEEDS_HUMAN reason=vercel-not-linked (run genesis or `vercel link` first)"

log $STAGE check-tools started
node scripts/deploy.mjs check-tools >/dev/null
log $STAGE check-tools passed

log $STAGE vercel-env started
node scripts/deploy.mjs vercel-env-dev >/dev/null
log $STAGE vercel-env passed

log $STAGE vercel-deploy started
deploy_json=$(last_json_line "$(node scripts/deploy.mjs vercel-deploy)")
url=$(json_field "$deploy_json" url)
dashboard=$(json_field "$deploy_json" dashboardUrl)
[ -n "$url" ] || die "vercel-deploy returned no url: $deploy_json"
log $STAGE vercel-deploy passed url="$url"

repo_url=$(gh repo view "$owner/$name" --json url -q .url)
convex_url=$(grep -s '^NEXT_PUBLIC_CONVEX_URL=' .env.local | cut -d= -f2- || true)
convex_site_url=${convex_url/.convex.cloud/.convex.site}
frontend_api=$(grep -s '^NEXT_PUBLIC_CLERK_FRONTEND_API_URL=' .env.local | cut -d= -f2- || true)

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
