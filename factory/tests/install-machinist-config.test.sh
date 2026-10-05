#!/usr/bin/env bash
# The installer pins Machinist's foreman and shepherd prompts apart from the binary. Upstream
# removed both files after v0.4.0 (owainlewis/machinist#488), so a MACHINIST_VERSION bump must
# not move the prompt downloads: they follow MACHINIST_PROMPTS_REF, which defaults to v0.4.0.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fresh_sandbox; sb="$SANDBOX"
install="$FACTORY_ROOT/factory/scripts/install-machinist-config.sh"

export MACHINIST_HOME="$sb/machinist" MACHINIST_URL=http://127.0.0.1:7331 MACHINIST_LISTEN=127.0.0.1:7331 \
  MACHINIST_TOKEN_FILE="$sb/machinist/server/worker.token" MACHINIST_WORKER_NAME=test-worker \
  MACHINIST_MAX_CONCURRENT_JOBS=1 MACHINIST_REQUEST_LABEL=machinist:requested \
  SANDBOX_BACKEND=local SANDBOX_SNAPSHOT=none

# run_install — render with the current environment; prints the prompt URLs the installer fetched.
run_install() {
  : > "$FAKE_LOG"
  "$install" >/dev/null 2>&1 || true
  grep '^curl ' "$FAKE_LOG" || true
}

# --- the pin as shipped -----------------------------------------------------------------------
export MACHINIST_VERSION=v0.4.0 MACHINIST_PROMPTS_REF=v0.4.0
urls=$(run_install)
assert_contains "$urls" "/machinist/v0.4.0/examples/prompts/foreman.md" "foreman fetched at the prompts ref"
assert_contains "$urls" "/machinist/v0.4.0/examples/prompts/shepherd.md" "shepherd fetched at the prompts ref"
assert_file "$MACHINIST_HOME/prompts/foreman.md" "foreman prompt installed"
assert_file "$MACHINIST_HOME/prompts/shepherd.md" "shepherd prompt installed"
assert_file "$MACHINIST_HOME/config.toml" "config.toml rendered"

# --- a release bump leaves the prompts where they are -----------------------------------------
export MACHINIST_VERSION=v0.5.0 MACHINIST_PROMPTS_REF=v0.4.0
urls=$(run_install)
assert_contains "$urls" "/machinist/v0.4.0/examples/prompts/foreman.md" "bumped binary, foreman still at the prompts ref"
assert_not_contains "$urls" "/machinist/v0.5.0/" "bumped binary fetches no prompt at the new version"

# --- the default ref is the last release that carried the prompts ----------------------------
unset MACHINIST_PROMPTS_REF
export MACHINIST_VERSION=v0.5.0
urls=$(run_install)
assert_contains "$urls" "/machinist/v0.4.0/examples/prompts/shepherd.md" "unset prompts ref defaults to v0.4.0"
assert_not_contains "$urls" "/machinist/v0.5.0/" "default ref does not follow the version"

test_summary install-machinist-config
