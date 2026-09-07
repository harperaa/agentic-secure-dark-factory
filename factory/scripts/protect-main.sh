#!/usr/bin/env bash
# Add required status-check contexts to an existing branch protection without editing
# SVCOS's lockdown-main.sh (design §4.8). Run after lockdown-main.sh.
# Usage: protect-main.sh <owner/repo> <context,context,...> [branch]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd gh jq
repo="${1:-}"; contexts="${2:-}"; branch="${3:-main}"
[ -n "$repo" ] && [ -n "$contexts" ] || die "usage: protect-main.sh <owner/repo> <context,...> [branch]"

current=$(gh api "repos/$repo/branches/$branch/protection/required_status_checks" --jq '.contexts')
merged=$(jq -cn --argjson cur "$current" --arg add "$contexts" \
  '($cur + ($add | split(","))) | map(select(length > 0)) | unique')
gh api -X PATCH "repos/$repo/branches/$branch/protection/required_status_checks" \
  --input - <<<"$(jq -cn --argjson c "$merged" '{strict: true, contexts: $c}')" >/dev/null
log PROTECT required-checks passed repo="$repo" contexts="$(jq -r 'join(",")' <<<"$merged")"
