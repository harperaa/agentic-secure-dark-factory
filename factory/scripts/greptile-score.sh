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

export GREPTILE_BOT_LOGIN
review=$(gh api "repos/$repo/pulls/$pr/reviews" --paginate \
  --jq '[.[] | select(.user.login == $ENV.GREPTILE_BOT_LOGIN)] | last // empty')
# Greptile posts its summary and confidence score as an issue comment (HTML), and inline findings
# as review comments; a formal PR review is optional. Take the newest score from either place.
summary=$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq '[.[] | select(.user.login == $ENV.GREPTILE_BOT_LOGIN) | select(.body | test("Confidence Score"))] | last // empty')
# Take the score from whichever of the two is newer among those that carry one, so a fresh review
# is never shadowed by an older summary (or the reverse) and a score-less review never blanks it.
newest=$(jq -cn --argjson r "${review:-null}" --argjson s "${summary:-null}" '
  [ (if $r then {at: ($r.submitted_at // ""), body: ($r.body // "")} else empty end),
    (if $s then {at: ($s.created_at // ""), body: ($s.body // "")} else empty end) ]
  | map(select(.body | test("Confidence Score"))) | sort_by(.at) | last // {body: ""}')
score=$(printf '%s' "$newest" | jq -r '.body' | grep -oE 'Confidence Score:?\s*[0-5]\s*/\s*5' | grep -oE '[0-5]' | head -n 1 || true)
comments=$(gh api "repos/$repo/pulls/$pr/comments" --paginate \
  --jq '[.[] | select(.user.login == $ENV.GREPTILE_BOT_LOGIN) | {id, path, line, body, in_reply_to_id}]')

jq -cn --arg score "$score" --argjson review "${review:-null}" --argjson summary "${summary:-null}" --argjson comments "$comments" \
  '{score: (if $score == "" then null else ($score | tonumber) end), review_id: ($review.id // $summary.id // null), submitted_at: ($review.submitted_at // $summary.created_at // null), comments: $comments}'
