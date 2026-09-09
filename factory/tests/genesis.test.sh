#!/usr/bin/env bash
# End-to-end genesis contract test against fake CLIs: the step sequence and RESULT line for a
# fresh run and for an idempotent re-run are golden, failures stop the stage with ERROR step=...,
# and the profile gate refuses before anything is cloned.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fresh_sandbox; sb="$SANDBOX"
make_template "$sb"
genesis="$FACTORY_ROOT/factory/scripts/genesis.sh"

run_genesis() {
  # genesis runs inside the registered workspace repository (Machinist's cwd contract)
  (cd "$FACTORY_WORKSPACE" && "$genesis" <<<"$1" 2>&1) || true
}

# --- fresh run ----------------------------------------------------------------------------
out=$(run_genesis "$(spec_json g1)")
expected_fresh="GENESIS clone started
GENESIS clone passed
GENESIS npm-ci started
GENESIS npm-ci passed
GENESIS audit-fix skipped
GENESIS doppler-bootstrap started
GENESIS doppler-bootstrap passed
GENESIS init started
GENESIS init-claim-url passed
GENESIS init passed
GENESIS modules started
GENESIS modules passed
GENESIS convex-setup started
GENESIS convex-setup passed
GENESIS configure started
GENESIS configure passed
GENESIS doppler-sync started
GENESIS doppler-sync passed
GENESIS generated-files started
GENERATED security_context/accepted.json passed
GENERATED .semgrepignore passed
GENERATED .secrets.baseline passed
GENERATED .github/workflows/factory-security.yml passed
GENERATED AGENTS.md passed
GENESIS generated-files passed
GENESIS github-setup started
GENESIS github-setup passed
GENESIS doppler-ci-token started
GENESIS doppler-ci-token passed
GENESIS vercel-link started
GENESIS vercel-link passed
GENESIS vercel-config started
GENESIS vercel-config passed
GENESIS push started
GENESIS push passed
GENESIS deploy-dev started
DEPLOY_DEV check-tools started
DEPLOY_DEV check-tools passed
DEPLOY_DEV vercel-env started
DEPLOY_DEV vercel-env passed
DEPLOY_DEV vercel-deploy started
DEPLOY_DEV vercel-deploy passed
DEPLOY_DEV write-summary started
DEPLOY_DEV write-summary passed
GENESIS deploy-dev passed
GENESIS lockdown started
PROTECT required-checks passed
GENESIS lockdown passed"
assert_eq "$(genesis_steps "$out" | grep -v '^GENERATED' ; true)" "$(printf '%s\n' "$expected_fresh" | grep -v '^GENERATED')" "fresh run emits the golden step sequence"
assert_eq "$(genesis_steps "$out" | grep -c '^GENERATED .* passed')" 5 "five factory-owned files are written"
assert_contains "$out" "RESULT status=ready repo=fixture-owner/g1 repo_url=https://github.com/fixture-owner/g1 url=https://fake-product.vercel.app sandbox=local clerk_claim_url=https://dashboard.clerk.com/apps/claim?token=fake" "RESULT line is unchanged"
assert_contains "$out" '"claimUrl": "https://dashboard.clerk.com/apps/claim?token=fake"' "init output with the claim URL is in the run record"
prod="$FACTORY_WORKSPACE/g1"
assert_file "$prod/AGENTS.md" "AGENTS.md generated into the product"
assert_file "$prod/docs/DEPLOYMENT-DEV.md" "deployment summary written"
assert_contains "$(head -n 1 "$prod/docs/DEPLOYMENT-DEV.md")" "# Dev Deployment Summary" "deployment summary header"
assert_eq "$(jq -r .buildCommand "$prod/vercel.json")" "node scripts/vercel-prebuild.mjs && npm run build" "product vercel.json is the Doppler-mode build"
assert_contains "$(cat "$FAKE_DOPPLER_STORE")" "FACTORY_CLERK_CLAIM_URL=https://dashboard.clerk.com/apps/claim?token=fake" "claim URL persisted in the secrets broker"
assert_contains "$(cat "$FAKE_DOPPLER_STORE")" "NEXT_PUBLIC_CONVEX_URL=https://fake-123.convex.cloud" "Convex URL synced to Doppler"
assert_not_contains "$(cat "$FAKE_DOPPLER_STORE")" "VERCEL_OIDC_TOKEN" "no Vercel token in Doppler"
assert_contains "$(cat "$FAKE_LOG")" "set-default fixture-owner/g1" "gh default repository pinned to the product"
assert_contains "$out" "Applying branch protection to fixture-owner/g1:main" "lockdown targets the product repository"
assert_eq "$(git -C "$prod" remote get-url upstream)" "$SVCOS_TEMPLATE_URL" "template kept as upstream remote"

# --- idempotent re-run --------------------------------------------------------------------
out=$(run_genesis "$(spec_json g1)")
expected_rerun="GENESIS clone skipped
GENESIS npm-ci skipped
GENESIS audit-fix skipped
GENESIS doppler-bootstrap skipped
GENESIS init skipped
GENESIS modules started
GENESIS modules passed
GENESIS convex-setup skipped
GENESIS configure started
GENESIS configure passed
GENESIS doppler-sync skipped
GENESIS generated-files started
GENESIS generated-files passed
GENESIS github-setup skipped
GENESIS doppler-ci-token skipped
GENESIS vercel-link skipped
GENESIS vercel-config skipped
GENESIS push started
GENESIS push passed
GENESIS deploy-dev started
DEPLOY_DEV check-tools started
DEPLOY_DEV check-tools passed
DEPLOY_DEV vercel-env started
DEPLOY_DEV vercel-env passed
DEPLOY_DEV vercel-deploy started
DEPLOY_DEV vercel-deploy passed
DEPLOY_DEV write-summary started
DEPLOY_DEV write-summary passed
GENESIS deploy-dev passed
GENESIS lockdown started
PROTECT required-checks passed
GENESIS lockdown passed"
assert_eq "$(genesis_steps "$out" | grep -v '^GENERATED'; true)" "$expected_rerun" "re-run skips every completed step"
assert_contains "$out" "RESULT status=ready repo=fixture-owner/g1" "re-run still reports the RESULT line"
assert_contains "$out" "clerk_claim_url=https://dashboard.clerk.com/apps/claim?token=fake" "re-run recovers the claim URL from the broker"

# --- failures stop the stage --------------------------------------------------------------
reset_stores
out=$(FAKE_FAIL=convex-setup bash -c "cd '$FACTORY_WORKSPACE' && '$genesis' <<<'$(spec_json g2)'" 2>&1 || true)
assert_contains "$out" "ERROR step=convex-setup reason=fake_convex-setup_failed" "success:false stops the stage with the script's error"
assert_not_contains "$out" "GENESIS step=convex-setup outcome=passed" "a failed step is never logged as passed"
reset_stores
out=$(FAKE_EXIT=github-setup bash -c "cd '$FACTORY_WORKSPACE' && '$genesis' <<<'$(spec_json g3)'" 2>&1 || true)
assert_contains "$out" "ERROR step=github-setup" "a non-zero exit stops the stage with the step name"
assert_contains "$out" "progress line" "output before the crash is still printed"

# --- profile gate refuses before cloning --------------------------------------------------
out=$(run_genesis "$(spec_json g4 eu '| .providers.payments="mollie"')")
assert_contains "$out" "NEEDS_HUMAN reason=provider-unsupported kind=payments name=mollie" "unsupported EU payments refused"
assert_no_file "$FACTORY_WORKSPACE/g4" "nothing cloned when the gate refuses"
out=$(run_genesis "$(spec_json g5 default '| .secrets_mode="env"')") # pragma: allowlist secret
assert_contains "$out" "NEEDS_HUMAN reason=secrets-mode-mismatch" "spec secrets_mode must match the adapter"

test_summary genesis
