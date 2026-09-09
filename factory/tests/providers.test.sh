#!/usr/bin/env bash
# Adapter-level contract tests (design R16): each adapter runs against fake CLIs and must
# produce the artifacts SVCOS expects. Also keeps the bash modules and the TypeScript registry
# in step.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fresh_sandbox; sb="$SANDBOX"
make_template "$sb"

# shellcheck source=../scripts/lib/common.sh
source "$FACTORY_ROOT/factory/scripts/lib/common.sh"
# shellcheck source=../providers/load.sh
source "$FACTORY_ROOT/factory/providers/load.sh"

# --- loader and gate -----------------------------------------------------------------------
providers_load "$(spec_json p1 default)"
assert_eq "$PROVIDER_HOSTING $PROVIDER_SECRETS $PROVIDER_BACKEND $PROVIDER_IDENTITY $PROVIDER_SCM" \
  "vercel doppler convex-cloud clerk github" "default profile resolves its adapters"
assert_eq "$(providers_capabilities | jq -r 'select(.kind=="secrets") | .secrets_mode')" doppler "doppler adapter declares doppler mode"
out=$(providers_gate 2>&1) && assert_eq "$out" "" "default gate passes with the required env"

out=$(VERCEL_SCOPE='' bash -c "source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p1)'; providers_gate" 2>&1 || true)
assert_contains "$out" "NEEDS_HUMAN reason=provider-env-missing kind=hosting name=vercel env=VERCEL_SCOPE" "gate names the missing env"

out=$(bash -c "source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p2 eu '| .providers.identity="keycloak"')'; providers_gate" 2>&1 || true)
assert_contains "$out" "NEEDS_HUMAN reason=provider-unsupported kind=identity name=keycloak" "EU identity swap is refused"
assert_contains "$out" "R14" "refusal cites design R14"

out=$(bash -c "source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p3 eu)'; printf '%s %s %s' \"\$PROVIDER_HOSTING\" \"\$PROVIDER_SECRETS\" \"\$PROVIDER_IDENTITY\"")
assert_eq "$out" "scaleway infisical clerk" "EU profile defaults to Scaleway, Infisical, Clerk identity (R14)"

# --- every bash module has a registry row -------------------------------------------------
missing=""
for f in "$FACTORY_ROOT"/factory/providers/*/*.sh; do
  kind=$(basename "$(dirname "$f")"); name=$(basename "$f" .sh)
  grep -q "kind: \"$kind\", name: \"$name\"" "$FACTORY_ROOT/control-plane/factory/providers/registry.ts" || missing="$missing $kind/$name"
done
assert_eq "$missing" "" "registry.ts lists every bash adapter module"

# --- hosting/vercel: vercel.json per mode, merge, probe -------------------------------------
prod=$(make_product "$sb" p1); cd "$prod" || exit 1
hosting_config_current doppler && fail "template vercel.json is not current" || pass "template vercel.json is detected as stale"
hosting_write_config doppler
assert_eq "$(jq -r .buildCommand vercel.json)" "node scripts/vercel-prebuild.mjs && npm run build" "doppler mode buildCommand"
assert_eq "$(jq -r .framework vercel.json)" nextjs "framework nextjs"
hosting_config_current doppler && pass "written vercel.json is current" || fail "written vercel.json should be current"
jq '. + {regions:["fra1"], headers:[{source:"/(.*)", headers:[]}]}' vercel.json > v.tmp && mv v.tmp vercel.json
hosting_write_config doppler
assert_eq "$(jq -r '.regions[0]' vercel.json)" fra1 "operator keys survive a rewrite"
hosting_write_config env
assert_eq "$(jq -r '.buildCommand // "none"' vercel.json)" none "env mode drops the buildCommand"
assert_eq "$(jq -r '.regions[0]' vercel.json)" fra1 "operator keys survive the env-mode rewrite"
hosting_link p1
assert_file .vercel/project.json "vercel link writes .vercel/project.json"
hosting_is_linked && pass "is_linked after link" || fail "is_linked after link"

# --- secrets/doppler: probes fail closed, sync pushes only Convex keys, ci token revokes -----
printf 'setup:\n  project: p1\n  config: dev\n' > .doppler.yaml
secrets_has NEXT_PUBLIC_CONVEX_URL && fail "empty store reports configured" || pass "empty store reports not configured"
printf 'CONVEX_DEPLOYMENT=dev:x\nNEXT_PUBLIC_CONVEX_URL=https://x.convex.cloud\nNEXT_PUBLIC_CONVEX_SITE_URL=https://x.convex.site\nVERCEL_OIDC_TOKEN=eyJ.secret\n' > .env.local
secrets_has NEXT_PUBLIC_CONVEX_URL && pass "probe reads .env.local before the sync" || fail "probe should read .env.local"
secrets_synced && fail "not synced before sync" || pass "synced probe false before sync"
secrets_sync_local >/dev/null
assert_contains "$(cat "$FAKE_DOPPLER_STORE")" "NEXT_PUBLIC_CONVEX_URL=https://x.convex.cloud" "sync pushes the Convex URL"
assert_not_contains "$(cat "$FAKE_DOPPLER_STORE")" "VERCEL_OIDC_TOKEN" "sync never pushes VERCEL_OIDC_TOKEN"
secrets_synced && pass "synced probe true after sync" || fail "synced probe should be true after sync"
out=$(FAKE_DOPPLER_DOWN=1 bash -c "cd '$prod'; source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p1)'; secrets_has NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" 2>&1 || true)
assert_contains "$out" "ERROR step=doppler-check" "an unreachable Doppler is fatal, never 'not configured'"
export FAKE_DOPPLER_TOKENS='[{"name":"github-actions-ci","slug":"old-1"},{"name":"vercel-runtime-dev","slug":"keep-1"},{"name":"github-actions-ci","slug":"old-2"}]'
secrets_ci_token fixture-owner/p1 >/dev/null
assert_contains "$(cat "$FAKE_LOG")" "revoked old-1" "stale CI token old-1 revoked"
assert_contains "$(cat "$FAKE_LOG")" "revoked old-2" "stale CI token old-2 revoked"
assert_not_contains "$(cat "$FAKE_LOG")" "revoked keep-1" "other tokens are left alone"
assert_contains "$(cat "$FAKE_LOG")" "doppler-create-ci-token" "CI token created through SVCOS"
secrets_has_ci_token fixture-owner/p1 && pass "has_ci_token after creation" || fail "has_ci_token after creation"
unset FAKE_DOPPLER_TOKENS

# --- identity/clerk: init warning about Doppler is a failure ---------------------------------
out=$(FAKE_INIT_WARNING=1 bash -c "cd '$prod'; source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p1)'; identity_create_app p1 o@x.test" 2>&1 || true)
assert_contains "$out" "claimUrl" "init output (claim URL) is printed before failing"
assert_contains "$out" "ERROR step=init reason=secrets-push-failed" "Doppler push warning fails init"

# --- secrets/infisical (env mode): bootstrap writes .env.local shape --------------------------
prod2=$(make_product "$sb" p3); cd "$prod2" || exit 1
printf 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_eu\nCSRF_SECRET=abc\n' > "$FAKE_INFISICAL_STORE" # pragma: allowlist secret
export INFISICAL_PROJECT_ID=proj-fake INFISICAL_API_URL=https://eu.infisical.test
bash -c "cd '$prod2'; source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p3 eu)'; secrets_bootstrap p3; secrets_mode" > mode.txt
assert_eq "$(cat mode.txt)" env "infisical adapter is env mode"
assert_file .infisical.json "infisical bootstrap pins the project"
assert_contains "$(cat .env.local)" "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_eu" ".env.local has the exported keys in SVCOS shape"
assert_no_file .doppler.yaml "env mode never writes .doppler.yaml"
out=$(bash -c "cd '$prod2'; source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p3 eu)'; secrets_supports_ci_token && echo yes || echo no")
assert_eq "$out" no "infisical declares no CI token support (human gate)"

# --- hosting/scaleway: config, link, deploy artifacts ---------------------------------------
export SCW_REGION=fr-par SCW_CONTAINER_NAMESPACE_ID=ns-fake SCW_REGISTRY_ENDPOINT=rg.fr-par.scw.cloud/fake
out=$(bash -c "cd '$prod2'; source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/load.sh'; providers_load '$(spec_json p3 eu)'; hosting_write_config env; hosting_link p3; hosting_deploy")
assert_file "$prod2/Dockerfile" "scaleway writes a factory-managed Dockerfile"
assert_contains "$(cat "$prod2/Dockerfile")" "factory-managed" "Dockerfile carries the factory marker"
assert_file "$prod2/.scaleway/container.json" "scaleway link records the container"
assert_eq "$(printf '%s' "$out" | tail -n 1 | jq -r .url)" "https://fake.functions.fnc.fr-par.scw.cloud" "scaleway deploy reports the container URL"

# --- llm presets: EU region enforcement ---------------------------------------------------
out=$(AWS_REGION=us-east-1 bash -c "source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/llm/anthropic-bedrock-eu.sh'; llm_anthropic_bedrock_eu_env" 2>&1 || true)
assert_contains "$out" "not an EU region" "bedrock-eu refuses a US region"
out=$(AWS_REGION=eu-central-1 bash -c "source '$FACTORY_ROOT/factory/scripts/lib/common.sh'; source '$FACTORY_ROOT/factory/providers/llm/anthropic-bedrock-eu.sh'; llm_anthropic_bedrock_eu_env")
assert_contains "$out" "CLAUDE_CODE_USE_BEDROCK=1" "bedrock-eu emits the executor env"

test_summary providers
