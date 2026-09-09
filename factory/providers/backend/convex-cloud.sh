#!/usr/bin/env bash
# backend/convex-cloud — Convex Cloud via SVCOS setup.mjs convex-setup. Default profile.
# Verified 2026-09-07 (project created headlessly with a CLI login; design R1).

backend_convex_cloud_capabilities() {
  jq -cn '{kind:"backend", name:"convex-cloud", implemented:true, verified:true,
    needs_env:[], optional_env:["CONVEX_TEAM"], needs_cmd:["npx"],
    supports:["create_project","has_project","url","deploy_functions"]}'
}

# backend_convex_cloud_has_project — convex-setup writes NEXT_PUBLIC_CONVEX_URL to .env.local
# only; the secrets broker gets it in the sync step. secrets_get reads the union of both.
backend_convex_cloud_has_project() { secrets_has NEXT_PUBLIC_CONVEX_URL; }

backend_convex_cloud_url() { secrets_get NEXT_PUBLIC_CONVEX_URL; }

# backend_convex_cloud_create_project NAME — create the dev deployment and push functions.
backend_convex_cloud_create_project() {
  local args=(convex-setup "--project-name=$1")
  [ -n "${CONVEX_TEAM:-}" ] && args+=("--team=$CONVEX_TEAM")
  run_svcos convex-setup node scripts/setup.mjs "${args[@]}"
}

# backend_convex_cloud_deploy_functions [dev|prod] — push functions; prod needs CONVEX_DEPLOY_KEY.
backend_convex_cloud_deploy_functions() {
  if [ "${1:-dev}" = "prod" ]; then
    npx convex deploy
  else
    npx convex dev --once
  fi
}
