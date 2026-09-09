#!/usr/bin/env bash
# Contract tests for factory/scripts/greptile-score.sh against a fake gh serving fixtures.
set -euo pipefail
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$TESTS_DIR/lib.sh"
fresh_sandbox
export GREPTILE_BOT_LOGIN='greptile-apps[bot]'
reader="$TESTS_DIR/../scripts/greptile-score.sh"
run_case() { FAKE_GH_REVIEW_DIR="$TESTS_DIR/fixtures/review/$1" "$reader" fake/repo 1; }

out=$(run_case summary-only)
assert_eq "$(jq -r .score <<<"$out")" 5 "summary-only: score comes from the summary comment"
assert_eq "$(jq -r .scored_at <<<"$out")" "2026-09-02T00:00:00Z" "summary-only: freshness is the comment's updated_at (Greptile edits in place)"
assert_eq "$(jq -r .unresolved <<<"$out")" 1 "summary-only: unresolved counts only unresolved bot threads"

out=$(run_case review-newer)
assert_eq "$(jq -r .score <<<"$out")" 3 "review-newer: a newer formal review wins over an older summary"
assert_eq "$(jq -r .scored_at <<<"$out")" "2026-09-03T00:00:00Z" "review-newer: freshness follows the winning source"

out=$(run_case scoreless-review)
assert_eq "$(jq -r .score <<<"$out")" 5 "scoreless-review: a newer review without a score does not blank the summary score"

out=$(run_case paginated)
assert_eq "$(jq -r .unresolved <<<"$out")" 2 "paginated: unresolved threads are summed across pages"

test_summary review
