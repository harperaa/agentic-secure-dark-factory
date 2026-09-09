#!/usr/bin/env bash
# GENESIS stage (design §4.5): factory-spec.json on stdin -> product repo, provider resources, dev URL.
#
# Machinist contract: exit 0 is success; the final RESULT line is parsed from the run's events.
# Idempotent (design §12.2 #4): every step probes for its own artifact before acting, so a
# killed run re-executes from the top and skips what already exists.
#
# Runs in the registered `factory-workspace` repository directory; the product is cloned beneath it.
# Inputs: spec on stdin; operator environment from factory.env (see factory/config/factory.env.example).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

STAGE=GENESIS
require_cmd git node npm npx gh jq
require_env FACTORY_ROOT FACTORY_WORKSPACE SVCOS_TEMPLATE_URL SVCOS_TEMPLATE_REF VERCEL_SCOPE \
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
profile=$(jq -r '.providers.profile // empty' <<<"$SPEC")

[ "$profile" = "default" ] || die "NEEDS_HUMAN reason=profile-unsupported profile=$profile (only the default provider profile is implemented; see docs/providers)"
[ "$secrets_mode" = "doppler" ] || die "NEEDS_HUMAN reason=secrets-mode-unsupported secrets_mode=$secrets_mode (env mode arrives with the Infisical adapter in M7)" # pragma: allowlist secret

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

# --- 3. Secrets broker (Doppler mode) -----------------------------------------------------
if [ -f .doppler.yaml ]; then
  log $STAGE doppler-bootstrap skipped
else
  # Local runtime: the worker account's Doppler CLI login is the credential (design §8.1).
  # Cloud sandboxes inject DOPPLER_TOKEN per run instead.
  if [ -z "${DOPPLER_TOKEN:-}" ] && ! doppler me >/dev/null 2>&1; then
    printf 'MISSING_ENV DOPPLER_TOKEN (or a Doppler CLI login for this account)\n' >&2
    exit 2
  fi
  log $STAGE doppler-bootstrap started
  node scripts/setup.mjs doppler-bootstrap --project-name="$name"
  log $STAGE doppler-bootstrap passed
fi

# --- 4. Init (Clerk keys, app secrets, env) -----------------------------------------------
claim_url=""
if has_setting NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY; then
  claim_url=$(get_setting FACTORY_CLERK_CLAIM_URL)
  log $STAGE init skipped
else
  log $STAGE init started
  init_args=(init "--site-name=$name" "--admin-email=$email")
  if [ -n "$clerk_pk" ]; then
    [ -n "$clerk_sk_ref" ] || die "MISSING_ARG clerk.secret_key_ref"
    # The secret is resolved through the secrets adapter, never read from the spec.
    clerk_sk=$("$SCRIPT_DIR/resolve-secret.sh" "$clerk_sk_ref")
    init_args+=("--clerk-pk=$clerk_pk" "--clerk-sk=$clerk_sk")
  fi
  init_out=$(node scripts/setup.mjs "${init_args[@]}")
  init_json=$(last_json_line "$init_out")
  assert_success "$init_json" init
  claim_url=$(json_field "$init_json" claimUrl)
  # The claim URL is returned exactly once; keep it in the secrets broker so a re-run and the
  # hand-off can still surface it (design R9).
  if [ -n "$claim_url" ] && [ -f .doppler.yaml ]; then
    doppler secrets set FACTORY_CLERK_CLAIM_URL="$claim_url" --config dev --silent >/dev/null
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

# --- 6. Convex project --------------------------------------------------------------------
if has_setting NEXT_PUBLIC_CONVEX_URL; then
  log $STAGE convex-setup skipped
else
  log $STAGE convex-setup started
  convex_args=(convex-setup "--project-name=$name")
  [ -n "${CONVEX_TEAM:-}" ] && convex_args+=("--team=$CONVEX_TEAM")
  convex_out=$(node scripts/setup.mjs "${convex_args[@]}")
  printf '%s\n' "$convex_out"
  assert_success "$(last_json_line "$convex_out")" convex-setup
  log $STAGE convex-setup passed
fi

# --- 7. Configure webhook + Convex env, install summary -----------------------------------
log $STAGE configure started
configure_out=$(node scripts/setup.mjs configure --admin-email="$email")
printf '%s\n' "$configure_out"
assert_success "$(last_json_line "$configure_out")" configure
node scripts/setup.mjs write-install-summary \
  --modules-installed="${modules// /,}" \
  ${claim_url:+--claim-url="$claim_url" --accountless=true}
log $STAGE configure passed

# --- 7b. Doppler post-init: Convex writes its outputs to .env.local; push them to Doppler dev
if [ -f .doppler.yaml ]; then
  log $STAGE doppler-sync started
  sync_out=$(node scripts/setup.mjs doppler-sync-env-local)
  printf '%s\n' "$sync_out"
  assert_success "$(last_json_line "$sync_out")" doppler-sync
  log $STAGE doppler-sync passed
fi

# --- 8. Factory-owned files (AGENTS.md, security workflow, baselines) ---------------------
log $STAGE generated-files started
"$SCRIPT_DIR/apply-generated.sh" "$target"
log $STAGE generated-files passed

# --- 9. GitHub repository (creates, sets origin, pushes main) -----------------------------
origin=$(git remote get-url origin 2>/dev/null || true)
if [[ "$origin" == *"/$owner/$name"* || "$origin" == *":$owner/$name"* ]]; then
  log $STAGE github-setup skipped origin="$origin"
else
  log $STAGE github-setup started
  git add -A
  git diff --cached --quiet || git -c user.name="${GIT_AUTHOR_NAME:-factory}" -c user.email="${GIT_AUTHOR_EMAIL:-$email}" \
    commit -q -m "chore: factory genesis for $name"
  gh_out=$(node scripts/deploy.mjs github-setup --repo-name="$name" --owner="$owner")
  printf '%s\n' "$gh_out"
  assert_success "$(last_json_line "$gh_out")" github-setup
  log $STAGE github-setup passed
fi
repo_url=$(gh repo view "$owner/$name" --json url -q .url)
# With origin and upstream both present, gh would otherwise resolve upstream (the template) as
# the default repository for every later gh call in this checkout, including lockdown-main.sh.
gh repo set-default "$owner/$name"

# --- 9b. Doppler CI token pushed to GitHub Actions (needs the repo to exist) ---------------
if [ -f .doppler.yaml ]; then
  if gh secret list --repo "$owner/$name" --json name -q '.[].name' 2>/dev/null | grep -qx DOPPLER_TOKEN; then
    log $STAGE doppler-ci-token skipped
  else
    log $STAGE doppler-ci-token started
    # The product has origin and upstream remotes; tell gh which repo without patching SVCOS.
    ci_out=$(GH_REPO="$owner/$name" node scripts/setup.mjs doppler-create-ci-token)
    printf '%s\n' "$ci_out"
    assert_success "$(last_json_line "$ci_out")" doppler-ci-token
    log $STAGE doppler-ci-token passed
  fi
fi

# --- 10. Vercel link and git connect ------------------------------------------------------
if [ -f .vercel/project.json ]; then
  log $STAGE vercel-link skipped
else
  log $STAGE vercel-link started
  npx vercel project add "$name" --scope="$VERCEL_SCOPE" >/dev/null 2>&1 || true
  npx vercel link --yes --project="$name" --scope="$VERCEL_SCOPE"
  npx vercel git connect "$(git remote get-url origin)" --yes --scope="$VERCEL_SCOPE" || \
    log $STAGE vercel-git-connect failed reason=non-fatal
  log $STAGE vercel-link passed
fi

# --- 10b. vercel.json for the active mode (mirrors /deploy-to-dev step 3) ------------------
# The template's own vercel.json re-installs modules at build time so the demo site renders;
# a product has its modules committed, so that command must go or the Vercel build fails.
log $STAGE vercel-config started
if [ -f .doppler.yaml ]; then
  jq -n '{"$schema":"https://openapi.vercel.sh/vercel.json", framework:"nextjs", buildCommand:"node scripts/vercel-prebuild.mjs && npm run build"}' > vercel.json
else
  jq -n '{framework:"nextjs"}' > vercel.json
fi
grep -q 'modules.mjs install' vercel.json && die "vercel.json still re-installs modules"
log $STAGE vercel-config passed mode="$([ -f .doppler.yaml ] && echo doppler || echo env)"

# --- 11. Push everything the steps above changed ------------------------------------------
log $STAGE push started
git add -A
git diff --cached --quiet || git -c user.name="${GIT_AUTHOR_NAME:-factory}" -c user.email="${GIT_AUTHOR_EMAIL:-$email}" \
  commit -q -m "chore: factory configuration"
git push -u origin HEAD
log $STAGE push passed

# --- 12. Dev deploy -----------------------------------------------------------------------
log $STAGE deploy-dev started
deploy_out=$("$SCRIPT_DIR/deploy-dev.sh" <<<"$(jq -n --arg n "$name" --arg o "$owner" --arg s "$VERCEL_SCOPE" --arg e "$email" \
  '{name:$n, github_owner:$o, vercel_scope:$s, admin_email:$e}')")
printf '%s\n' "$deploy_out"
url=$(printf '%s\n' "$deploy_out" | sed -n 's/^DEPLOY_RESULT .*url=\([^ ]*\).*/\1/p' | tail -n 1)
[ -n "$url" ] || die "deploy-dev produced no URL"
log $STAGE deploy-dev passed

# --- 13. Branch protection ----------------------------------------------------------------
log $STAGE lockdown started mode="$mode"
lockdown_mode=$([ "$mode" = "dark" ] && printf '%s' "$LOCKDOWN_MODE_DARK" || printf '%s' "$LOCKDOWN_MODE_GRAY")
if [ "$lockdown_mode" = "solo" ]; then GH_REPO="$owner/$name" ./scripts/lockdown-main.sh --solo; else GH_REPO="$owner/$name" ./scripts/lockdown-main.sh; fi
"$SCRIPT_DIR/protect-main.sh" "$owner/$name" "$FACTORY_REQUIRED_CONTEXTS"
log $STAGE lockdown passed

printf 'RESULT status=ready repo=%s/%s repo_url=%s url=%s sandbox=%s%s\n' \
  "$owner" "$name" "$repo_url" "$url" "$sandbox" "${claim_url:+ clerk_claim_url=$claim_url}"
