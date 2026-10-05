#!/usr/bin/env bash
# protect-repo.sh re-applies a product's branch protection for its mode: dark runs the template's
# lockdown in the operator's dark lockdown mode (solo here), gray in the gray one (team), and the
# factory's required contexts are added after either.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fresh_sandbox; sb="$SANDBOX"
make_template "$sb"
make_product "$sb" p1 >/dev/null
protect="$FACTORY_ROOT/factory/scripts/protect-repo.sh"

out=$("$protect" fixture-owner/p1 dark p1 '{"profile":"default"}' 2>&1 || true)
assert_contains "$out" "PROTECT step=lockdown outcome=passed repo=fixture-owner/p1 mode=dark lockdown=solo" "dark mode locks down in the dark lockdown mode"
assert_contains "$(cat "$FAKE_LOG")" "lockdown --solo" "the template's lockdown ran with --solo"
assert_contains "$out" "PROTECT step=required-checks outcome=passed repo=fixture-owner/p1" "the factory's contexts are re-added"

: > "$FAKE_LOG"
out=$("$protect" fixture-owner/p1 gray p1 '{"profile":"default"}' 2>&1 || true)
assert_contains "$out" "mode=gray lockdown=team" "gray mode locks down in the gray lockdown mode"
assert_not_contains "$(cat "$FAKE_LOG")" "lockdown --solo" "team mode does not pass --solo"

out=$("$protect" fixture-owner/nope dark nope '{}' 2>&1 || true)
assert_contains "$out" "no product checkout" "a missing checkout is refused with the path"

test_summary protect-repo
