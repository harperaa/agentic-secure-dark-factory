#!/usr/bin/env bash
# GENESIS stage (design §4.5): factory-spec.json on stdin -> product repo, provider resources, dev URL.
#
# Machinist contract: exit 0 is success; the final RESULT line is parsed from the run's events.
# Idempotent (design §12.2 #4): every step probes for its own artifact before acting, so a
# killed run re-executes from the top and skips what already exists.
#
# Runs in the registered `factory-workspace` repository directory; the product is cloned beneath it.
# Inputs: spec on stdin; operator environment from factory.env (see factory/config/factory.env.example).
# Providers: every provider call goes through an adapter selected from the spec's providers block
# (factory/providers, design §4.11); this script never names Vercel, Doppler, Convex, or Clerk.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=../providers/load.sh
source "$SCRIPT_DIR/../providers/load.sh"

STAGE=GENESIS
require_cmd git node npm npx gh jq
require_env FACTORY_ROOT FACTORY_WORKSPACE SVCOS_TEMPLATE_URL SVCOS_TEMPLATE_REF \
  LOCKDOWN_MODE_DARK LOCKDOWN_MODE_GRAY FACTORY_REQUIRED_CONTEXTS

SPEC=$(cat)
[ -n "$SPEC" ] || die "empty spec on stdin"
jq -e . >/dev/null 2>&1 <<<"$SPEC" || die "spec is not valid JSON"

name=$(spec_get "$SPEC" name)
email=$(spec_get "$SPEC" admin_email)
owner=$(spec_get "$SPEC" github_owner)
mode=$(spec_get "$SPEC" mode)
secrets_mode=$(spec_get "$SPEC" secrets_mode)
modules=$(jq -r '(.modules // []) | join(" ")' <<<"$SPEC")
clerk_pk=$(jq -r '.clerk.publishable_key // empty' <<<"$SPEC")
clerk_sk_ref=$(jq -r '.clerk.secret_key_ref // empty' <<<"$SPEC")
sandbox=$(jq -r '.providers.sandbox // empty' <<<"$SPEC")

# --- 0. Provider profile gate (design §4.11 rules): refuse before touching anything ----------
providers_load "$SPEC"
providers_gate
[ "$(secrets_mode)" = "$secrets_mode" ] || \
  die "NEEDS_HUMAN reason=secrets-mode-mismatch spec=$secrets_mode adapter=$PROVIDER_SECRETS provides=$(secrets_mode)" # pragma: allowlist secret

workspace=$(expand_tilde "$FACTORY_WORKSPACE")
target="$workspace/$name"
mkdir -p "$workspace"

# --- 1. Clone the template ----------------------------------------------------------------
if [ -d "$target/.git" ]; then
  log $STAGE clone skipped path="$target"
else
  log $STAGE clone started
  # A full clone: the product keeps the template history so SVCOS's upstream-merge commands
  # work, and a shallow root commit cannot be pushed (its parents were never fetched).
  git clone --branch "$SVCOS_TEMPLATE_REF" "$SVCOS_TEMPLATE_URL" "$target"
  log $STAGE clone passed
fi
cd "$target" || die "cannot enter $target"
if [ -f .git/shallow ]; then
  log $STAGE unshallow started
  template_remote=$(git remote -v | awk -v u="$SVCOS_TEMPLATE_URL" '$2==u {print $1; exit}')
  git fetch --unshallow "${template_remote:-origin}"
  log $STAGE unshallow passed
fi

# --- 2. Dependencies ----------------------------------------------------------------------
if [ -d node_modules ] && [ package-lock.json -ot node_modules ]; then
  log $STAGE npm-ci skipped
else
  log $STAGE npm-ci started
  npm ci --no-audit --no-fund
  log $STAGE npm-ci passed
fi

# --- 2b. Known advisories in the template lockfile (SVCOS issue #9) -------------------------
# A fresh product must not start with a failing required `security` check. `npm audit fix`
# honours the product's .npmrc cooldown; anything it cannot fix stays visible in CI.
if npm audit --audit-level=high >/dev/null 2>&1; then
  log $STAGE audit-fix skipped
else
  log $STAGE audit-fix started
  if npm audit fix --no-audit --no-fund >/dev/null 2>&1 && npm audit --audit-level=high >/dev/null 2>&1; then
    log $STAGE audit-fix passed
  else
    log $STAGE audit-fix failed reason=advisories-remain
  fi
fi

# --- 3. Secrets broker --------------------------------------------------------------------
step=$(secrets_step_name bootstrap)
if secrets_bootstrapped; then
  log $STAGE "$step" skipped
else
  log $STAGE "$step" started
  secrets_bootstrap "$name"
  log $STAGE "$step" passed
fi

# --- 4. Init (identity keys, app secrets, env) --------------------------------------------
claim_url=""
if identity_has_app; then
  claim_url=$(secrets_get FACTORY_CLERK_CLAIM_URL)
  log $STAGE init skipped
else
  log $STAGE init started
  clerk_sk=""
  if [ -n "$clerk_pk" ]; then
    [ -n "$clerk_sk_ref" ] || die "MISSING_ARG clerk.secret_key_ref"
    # The secret is resolved through the secrets adapter, never read from the spec.
    clerk_sk=$("$SCRIPT_DIR/resolve-secret.sh" "$clerk_sk_ref")
  fi
  # identity_create_app prints the full init output (claim URL included) into the run record
  # before anything else can fail, and leaves the compact result in SVCOS_JSON.
  identity_create_app "$name" "$email" "$clerk_pk" "$clerk_sk"
  init_json="$SVCOS_JSON"
  claim_url=$(json_field "$init_json" claimUrl)
  # The claim URL is returned exactly once; keep it in the secrets broker so a re-run and the
  # hand-off can still surface it (design R9). Losing the copy is logged, never fatal: the URL
  # is already in the run record above.
  if [ -n "$claim_url" ]; then
    if secrets_set FACTORY_CLERK_CLAIM_URL "$claim_url"; then
      log $STAGE init-claim-url passed
    else
      log $STAGE init-claim-url failed reason=secrets-set-failed note=claim-url-in-run-record
    fi
  fi
  log $STAGE init passed accountless="$(json_field "$init_json" accountless)"
fi

# --- 5. Content modules -------------------------------------------------------------------
if [ -n "$modules" ]; then
  log $STAGE modules started list="$modules"
  # shellcheck disable=SC2086
  node scripts/modules.mjs install $modules --apply-edits --json >/dev/null
  log $STAGE modules passed
else
  log $STAGE modules skipped
fi

# --- 6. Backend project -------------------------------------------------------------------
if backend_has_project; then
  log $STAGE convex-setup skipped
else
  log $STAGE convex-setup started
  backend_create_project "$name"
  log $STAGE convex-setup passed
fi

# --- 7. Configure webhook + backend env, install summary ----------------------------------
log $STAGE configure started
identity_configure "$email"
node scripts/setup.mjs write-install-summary \
  --modules-installed="${modules// /,}" \
  ${claim_url:+--claim-url="$claim_url" --accountless=true}
log $STAGE configure passed

# --- 7b. Secrets post-init: the backend writes its outputs to .env.local; push them up -------
if secrets_supports_sync_local; then
  step=$(secrets_step_name sync_local)
  if secrets_supports_synced && secrets_synced; then
    log $STAGE "$step" skipped
  else
    log $STAGE "$step" started
    secrets_sync_local
    log $STAGE "$step" passed
  fi
fi

# --- 8. Factory-owned files (AGENTS.md, security workflow, baselines) ---------------------
log $STAGE generated-files started
"$SCRIPT_DIR/apply-generated.sh" "$target"
log $STAGE generated-files passed

# --- 9. Source repository (creates, sets origin, pushes main) -----------------------------
if scm_has_repo "$owner" "$name"; then
  log $STAGE github-setup skipped origin="$(git remote get-url origin)"
else
  log $STAGE github-setup started
  git add -A
  git diff --cached --quiet || git -c user.name="${GIT_AUTHOR_NAME:-factory}" -c user.email="${GIT_AUTHOR_EMAIL:-$email}" \
    commit -q -m "chore: factory genesis for $name"
  scm_create_repo "$owner" "$name"
  log $STAGE github-setup passed
fi
repo_url=$(scm_repo_url "$owner" "$name")
scm_set_default "$owner" "$name"

# --- 9b. CI secret for the secrets broker (needs the repo to exist) -----------------------
step=$(secrets_step_name ci_token)
if ! secrets_supports_ci_token; then
  log $STAGE "$step" skipped reason=adapter-human-gate
elif secrets_has_ci_token "$owner/$name"; then
  log $STAGE "$step" skipped
else
  log $STAGE "$step" started
  secrets_ci_token "$owner/$name"
  log $STAGE "$step" passed
fi

# --- 10. Hosting link ---------------------------------------------------------------------
step=$(hosting_step_name link)
if hosting_is_linked; then
  log $STAGE "$step" skipped
else
  log $STAGE "$step" started
  hosting_link "$name"
  log $STAGE "$step" passed
fi

# --- 10b. Hosting build config for the active secrets mode --------------------------------
step=$(hosting_step_name config)
if hosting_supports_config_current && hosting_config_current "$(secrets_mode)"; then
  log $STAGE "$step" skipped mode="$(secrets_mode)"
else
  log $STAGE "$step" started
  hosting_write_config "$(secrets_mode)"
  log $STAGE "$step" passed mode="$(secrets_mode)"
fi

# --- 11. Push everything the steps above changed ------------------------------------------
log $STAGE push started
git add -A
git diff --cached --quiet || git -c user.name="${GIT_AUTHOR_NAME:-factory}" -c user.email="${GIT_AUTHOR_EMAIL:-$email}" \
  commit -q -m "chore: factory configuration"
git push -u origin HEAD
log $STAGE push passed

# --- 12. Dev deploy -----------------------------------------------------------------------
log $STAGE deploy-dev started
deploy_out=$("$SCRIPT_DIR/deploy-dev.sh" <<<"$(jq -n --arg n "$name" --arg o "$owner" --arg e "$email" --argjson p "$(jq -c '.providers' <<<"$SPEC")" \
  '{name:$n, github_owner:$o, admin_email:$e, providers:$p}')")
printf '%s\n' "$deploy_out"
url=$(printf '%s\n' "$deploy_out" | sed -n 's/^DEPLOY_RESULT .*url=\([^ ]*\).*/\1/p' | tail -n 1)
[ -n "$url" ] || die "deploy-dev produced no URL"
log $STAGE deploy-dev passed

# --- 13. Branch protection ----------------------------------------------------------------
log $STAGE lockdown started mode="$mode"
lockdown_mode=$([ "$mode" = "dark" ] && printf '%s' "$LOCKDOWN_MODE_DARK" || printf '%s' "$LOCKDOWN_MODE_GRAY")
scm_protect "$owner/$name" "$lockdown_mode" "$FACTORY_REQUIRED_CONTEXTS"
log $STAGE lockdown passed

printf 'RESULT status=ready repo=%s/%s repo_url=%s url=%s sandbox=%s%s\n' \
  "$owner" "$name" "$repo_url" "$url" "$sandbox" "${claim_url:+ clerk_claim_url=$claim_url}"
