#!/usr/bin/env bash
# Read the AI reviewer's latest confidence score and unresolved inline comments for a PR
# (design appendix D). Prints one JSON object: {"score": n|null, "review_id": ..., "comments": [...]}.
# Usage: greptile-score.sh <owner/repo> <pr-number>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd gh jq
require_env GREPTILE_BOT_LOGIN
repo="${1:-}"; pr="${2:-}"
[ -n "$repo" ] && [ -n "$pr" ] || die "usage: greptile-score.sh <owner/repo> <pr-number>"

review=$(gh api "repos/$repo/pulls/$pr/reviews" --paginate \
  --jq --arg bot "$GREPTILE_BOT_LOGIN" '[.[] | select(.user.login == $bot)] | last // empty')
# Greptile posts its summary and confidence score as an issue comment (HTML), and inline findings
# as review comments; a formal PR review is optional. Take the newest score from either place.
summary=$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq --arg bot "$GREPTILE_BOT_LOGIN" '[.[] | select(.user.login == $bot) | select(.body | test("Confidence Score"))] | last // empty')
score=$( { printf '%s' "$summary" | jq -r '.body // ""'; printf '%s' "$review" | jq -r '.body // ""'; } | grep -oE 'Confidence Score:?\s*[0-5]\s*/\s*5' | grep -oE '[0-5]' | head -n 1 || true)
comments=$(gh api "repos/$repo/pulls/$pr/comments" --paginate \
  --jq --arg bot "$GREPTILE_BOT_LOGIN" '[.[] | select(.user.login == $bot) | {id, path, line, body, in_reply_to_id}]')

jq -cn --arg score "$score" --argjson review "${review:-null}" --argjson summary "${summary:-null}" --argjson comments "$comments" \
  '{score: (if $score == "" then null else ($score | tonumber) end), review_id: ($review.id // $summary.id // null), submitted_at: ($review.submitted_at // $summary.created_at // null), comments: $comments}'
