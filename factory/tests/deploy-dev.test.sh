#!/usr/bin/env bash
# deploy-dev contract test: check-tools is asserted on what it reports, missing settings stop
# the stage instead of writing "(not configured)", and success writes the summary SVCOS expects.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fresh_sandbox; sb="$SANDBOX"
make_template "$sb"
deploy="$FACTORY_ROOT/factory/scripts/deploy-dev.sh"
prod=$(make_product "$sb" d1)
input=$(jq -cn '{name:"d1", github_owner:"fixture-owner", admin_email:"o@fixture.test", providers:{profile:"default", sandbox:"local"}}')

run_deploy() { (cd "$prod" && "$deploy" <<<"$input" 2>&1) || true; }

out=$(run_deploy)
assert_contains "$out" "NEEDS_HUMAN reason=hosting-not-linked" "unlinked product is refused"

mkdir -p "$prod/.vercel"; printf '{"projectId":"prj"}\n' > "$prod/.vercel/project.json"
printf 'setup:\n  project: d1\n  config: dev\n' > "$prod/.doppler.yaml"
out=$(FAKE_MISSING_TOOLS='"gh"' bash -c "cd '$prod' && '$deploy' <<<'$input'" 2>&1 || true)
assert_contains "$out" "ERROR step=check-tools reason=missing-tools tools=gh" "missing tools stop the stage"
out=$(FAKE_GH_AUTH=false bash -c "cd '$prod' && '$deploy' <<<'$input'" 2>&1 || true)
assert_contains "$out" "ERROR step=check-tools reason=gh-not-authenticated" "unauthenticated gh stops the stage"

out=$(run_deploy)
assert_contains "$out" "ERROR step=write-summary reason=missing-setting key=NEXT_PUBLIC_CONVEX_URL" "missing Convex URL stops the stage"
assert_no_file "$prod/docs/DEPLOYMENT-DEV.md" "no summary written on failure"

printf 'NEXT_PUBLIC_CONVEX_URL=https://d1.convex.cloud\nNEXT_PUBLIC_CLERK_FRONTEND_API_URL=https://d1.clerk.accounts.dev\n' > "$FAKE_DOPPLER_STORE"
out=$(run_deploy)
assert_contains "$out" "DEPLOY_RESULT status=ready url=https://fake-product.vercel.app" "deploy reports the URL"
assert_file "$prod/docs/DEPLOYMENT-DEV.md" "summary written on success"
assert_contains "$(cat "$prod/docs/DEPLOYMENT-DEV.md")" "--convex-site-url=https://d1.convex.site" "site URL derived from the Convex URL"
assert_contains "$(cat "$prod/docs/DEPLOYMENT-DEV.md")" "--frontend-api-url=https://d1.clerk.accounts.dev" "frontend API URL read from the broker"

test_summary deploy-dev
