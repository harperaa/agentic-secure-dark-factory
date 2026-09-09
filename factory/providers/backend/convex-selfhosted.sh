#!/usr/bin/env bash
# backend/convex-selfhosted — a self-hosted Convex deployment (Docker) in an EU region
# (design §4.11 backend row, R15). Real implementation, NOT verified here.
#
# The Convex CLI and the app code are identical to Convex Cloud; only project creation differs.
# The deployment already exists (provisioned by a person or the ops adapter); this adapter points
# the product at it through CONVEX_SELF_HOSTED_URL / CONVEX_SELF_HOSTED_ADMIN_KEY, records the
# public URL in the secrets adapter so SVCOS's configure step finds NEXT_PUBLIC_CONVEX_URL, and
# pushes functions with `npx convex deploy`, which honours those variables.

backend_convex_selfhosted_capabilities() {
  jq -cn '{kind:"backend", name:"convex-selfhosted", implemented:true, verified:false,
    needs_env:["CONVEX_SELF_HOSTED_URL","CONVEX_SELF_HOSTED_ADMIN_KEY"], needs_cmd:["npx"],
    supports:["create_project","has_project","url","deploy_functions"],
    human_gate:"provision the self-hosted Convex backend (Docker Compose on Scaleway/Hetzner) and its admin key", residency:"EU"}'
}

backend_convex_selfhosted_has_project() { secrets_has NEXT_PUBLIC_CONVEX_URL; }

backend_convex_selfhosted_url() { secrets_get NEXT_PUBLIC_CONVEX_URL; }

# backend_convex_selfhosted_create_project NAME — bind the product to the deployment and push functions.
backend_convex_selfhosted_create_project() {
  local site_url
  secrets_set NEXT_PUBLIC_CONVEX_URL "$CONVEX_SELF_HOSTED_URL"
  site_url="${CONVEX_SELF_HOSTED_SITE_URL:-$CONVEX_SELF_HOSTED_URL}"
  secrets_set NEXT_PUBLIC_CONVEX_SITE_URL "$site_url"
  if [ -f .env.local ]; then
    grep -q '^NEXT_PUBLIC_CONVEX_URL=' .env.local || printf 'NEXT_PUBLIC_CONVEX_URL=%s\n' "$CONVEX_SELF_HOSTED_URL" >> .env.local
  else
    printf 'NEXT_PUBLIC_CONVEX_URL=%s\n' "$CONVEX_SELF_HOSTED_URL" > .env.local
  fi
  backend_convex_selfhosted_deploy_functions dev
  jq -cn --arg u "$CONVEX_SELF_HOSTED_URL" '{success:true, convexUrl:$u, selfHosted:true}'
}

# backend_convex_selfhosted_deploy_functions [dev|prod] — same command either way; the
# deployment is selected by the self-hosted variables, not by a Cloud deploy key.
backend_convex_selfhosted_deploy_functions() {
  CONVEX_SELF_HOSTED_URL="$CONVEX_SELF_HOSTED_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY" npx convex deploy --yes
}
