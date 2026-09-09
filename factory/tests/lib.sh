#!/usr/bin/env bash
# Test helpers for the factory's bash contract tests. Sourced by factory/tests/*.test.sh.
#
# Every test runs with the fake CLIs from factory/tests/fakes first on PATH, a private HOME,
# and a scratch workspace. No test reaches the network or a real provider.

set -euo pipefail
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_ROOT="$(cd "$TESTS_DIR/../.." && pwd)"
export FACTORY_ROOT

_test_failures=0
_test_count=0

# fresh_sandbox — new scratch dir, fake stores, and env; sets SANDBOX. Call it directly, never
# inside $(...): the exports must reach the test's own shell.
fresh_sandbox() {
  local sb
  sb=$(mktemp -d)
  # shellcheck disable=SC2034  # read by the test files that source this library
  SANDBOX="$sb"
  mkdir -p "$sb/home" "$sb/workspace"
  export HOME="$sb/home"
  export PATH="$TESTS_DIR/fakes:$PATH"
  export FAKE_LOG="$sb/fake.log" FAKE_DOPPLER_STORE="$sb/doppler.env" FAKE_GH_SECRETS="$sb/gh-secrets" FAKE_INFISICAL_STORE="$sb/infisical.env" FAKE_REMOTES_DIR="$sb/remotes"
  mkdir -p "$FAKE_REMOTES_DIR"
  : > "$FAKE_LOG"; : > "$FAKE_DOPPLER_STORE"; : > "$FAKE_GH_SECRETS"; : > "$FAKE_INFISICAL_STORE"
  export FACTORY_WORKSPACE="$sb/workspace" WORKTREE_ROOT="$sb/worktrees"
  export VERCEL_SCOPE=fake-team CONVEX_TEAM=fake-team GREPTILE_BOT_LOGIN='fake[bot]'
  export LOCKDOWN_MODE_DARK=solo LOCKDOWN_MODE_GRAY=team FACTORY_REQUIRED_CONTEXTS=semgrep,secrets
  unset DOPPLER_TOKEN FAKE_FAIL FAKE_EXIT FAKE_INIT_WARNING FAKE_DOPPLER_DOWN FAKE_DOPPLER_TOKENS FAKE_MISSING_TOOLS FAKE_GH_AUTH
}

# make_template SANDBOX — a minimal SVCOS-shaped template repository (clone source); sets
# TEMPLATE_DIR and exports SVCOS_TEMPLATE_URL/REF. Call directly, never inside $(...).
make_template() {
  local dir="$1/template"
  # shellcheck disable=SC2034  # read by the test files that source this library
  TEMPLATE_DIR="$dir"
  mkdir -p "$dir/scripts" "$dir/docs"
  printf '{"name":"svcos-fixture","version":"0.0.0","engines":{"node":">=24"}}\n' > "$dir/package.json"
  printf '{"lockfileVersion":3}\n' > "$dir/package-lock.json"
  printf '{"$schema":"https://openapi.vercel.sh/vercel.json","framework":"nextjs","buildCommand":"node scripts/modules.mjs install --all --apply-edits && node scripts/vercel-prebuild.mjs && npm run build"}\n' > "$dir/vercel.json"
  printf 'node_modules/\n.env.local\n.vercel/\n' > "$dir/.gitignore"
  printf '#!/usr/bin/env bash\nprintf "lockdown %%s\\n" "$*" >> "${FAKE_LOG:-/dev/null}"\nprintf "Applying branch protection to %%s:main\\n" "${GH_REPO:-unknown}"\n' > "$dir/scripts/lockdown-main.sh"
  chmod +x "$dir/scripts/lockdown-main.sh"
  : > "$dir/scripts/setup.mjs"; : > "$dir/scripts/deploy.mjs"; : > "$dir/scripts/modules.mjs"
  git -C "$dir" init -q -b main
  git -C "$dir" -c user.name=t -c user.email=t@t add -A
  git -C "$dir" -c user.name=t -c user.email=t@t commit -q -m "template"
  export SVCOS_TEMPLATE_URL="$dir" SVCOS_TEMPLATE_REF=main
}

# reset_stores — empty the fake provider stores (they are per sandbox, not per product).
reset_stores() {
  : > "$FAKE_DOPPLER_STORE"; : > "$FAKE_GH_SECRETS"; : > "$FAKE_INFISICAL_STORE"
}

# make_product SANDBOX NAME — a product checkout (clone of the template) to run adapters in.
make_product() {
  local dir="$1/workspace/$2"
  git clone -q "$SVCOS_TEMPLATE_URL" "$dir"
  printf '%s' "$dir"
}

# spec_json NAME [PROFILE] [extra jq] — a valid factory-spec document.
spec_json() {
  jq -cn --arg n "$1" --arg p "${2:-default}" '{
    spec_version: 0, name: $n, pitch: "fixture", admin_email: "owner@fixture.test", github_owner: "fixture-owner",
    modules: ["homepage-content"], secrets_mode: (if $p == "eu" then "env" else "doppler" end),
    phases: [{title: "Phase one", acceptance: ["done"]}], mode: "gray", greptile_threshold: 5, max_repair_rounds: 2,
    forced_gray_paths: ["middleware.ts"], providers: {profile: $p, sandbox: "local"}
  } '"${3:-}"
}

# genesis_steps OUTPUT — the ordered step/outcome pairs from a genesis run's output.
genesis_steps() {
  printf '%s\n' "$1" | sed -nE 's/^(GENESIS|DEPLOY_DEV|GENERATED|PROTECT) step=([^ ]+) outcome=([^ ]+).*/\1 \2 \3/p'
}

pass() { _test_count=$((_test_count + 1)); printf '  ok   %s\n' "$1"; }
fail() { _test_count=$((_test_count + 1)); _test_failures=$((_test_failures + 1)); printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; return 0; }

assert_eq() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3" "expected: $2 | got: $1"; fi; }
assert_contains() { if printf '%s' "$1" | grep -qF -- "$2"; then pass "$3"; else fail "$3" "missing: $2"; fi; }
assert_not_contains() { if printf '%s' "$1" | grep -qF -- "$2"; then fail "$3" "unexpected: $2"; else pass "$3"; fi; }
assert_file() { if [ -f "$1" ]; then pass "$2"; else fail "$2" "missing file $1"; fi; }
assert_no_file() { if [ -e "$1" ]; then fail "$2" "unexpected file $1"; else pass "$2"; fi; }

test_summary() {
  printf '%s: %d checks, %d failures\n' "$1" "$_test_count" "$_test_failures"
  [ "$_test_failures" -eq 0 ]
}
