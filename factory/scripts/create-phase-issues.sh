#!/usr/bin/env bash
# Turn the spec's phases into GitHub issues so BUILD stages can run Machinist's unmodified
# foreman (design §4.6). Idempotent: an issue is matched by its `factory:phase-<n>` label.
# Usage: create-phase-issues.sh <spec.json> [--request-first]
#   --request-first  also apply the intake label to phase 1 so the foreman can start on it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd gh jq
require_env MACHINIST_REQUEST_LABEL
spec_path="${1:-}"; [ -f "$spec_path" ] || die "usage: create-phase-issues.sh <spec.json> [--request-first]"
request_first=false; [ "${2:-}" = "--request-first" ] && request_first=true
SPEC=$(cat "$spec_path")
name=$(spec_get "$SPEC" name); owner=$(spec_get "$SPEC" github_owner); repo="$owner/$name"

ensure_label() {
  gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null 2>&1 || true
}
ensure_label "$MACHINIST_REQUEST_LABEL" 0e8a16 "Ready for the Machinist foreman"
ensure_label "factory:forced-gray" b60205 "A human must apply machinist:auto-merge"
ensure_label "factory:security-finding" d93f0b "Opened from a security assessment finding"

count=$(jq '.phases | length' <<<"$SPEC")
for i in $(seq 0 $((count - 1))); do
  n=$((i + 1))
  label="factory:phase-$n"
  ensure_label "$label" 1d76db "Build phase $n from the product spec"
  title=$(jq -r ".phases[$i].title" <<<"$SPEC")
  existing=$(gh issue list --repo "$repo" --label "$label" --state all --json number -q '.[0].number')
  if [ -n "$existing" ]; then
    log PHASES "phase-$n" skipped issue="$existing"
    continue
  fi
  body=$(jq -r --arg pitch "$(spec_get "$SPEC" pitch)" --arg n "$n" --arg total "$count" "
    .phases[$i] |
    \"## Build phase \" + \$n + \" of \" + \$total + \"\n\n\" +
    \"**Product:** \" + \$pitch + \"\n\n\" +
    (if .description then \"## Description\n\n\" + .description + \"\n\n\" else \"\" end) +
    \"## Acceptance criteria\n\n\" + (.acceptance | map(\"- [ ] \" + .) | join(\"\n\")) + \"\n\n\" +
    (if .touches then \"## Expected paths\n\n\" + (.touches | map(\"- \`\" + . + \"\`\") | join(\"\n\")) + \"\n\n\" else \"\" end) +
    \"## Conventions\n\nFollow AGENTS.md. One pull request to main. Conventional Commits. Run lint, typecheck, test, and build before hand-off.\n\n<!-- factory:phase=\" + \$n + \" -->\"
  " <<<"$SPEC")
  url=$(gh issue create --repo "$repo" --title "Phase $n: $title" --body "$body" --label "$label")
  log PHASES "phase-$n" passed issue="$url"
  if [ "$n" -eq 1 ] && $request_first; then
    gh issue edit "$url" --add-label "$MACHINIST_REQUEST_LABEL" >/dev/null
    log PHASES "phase-$n" requested
  fi
done
