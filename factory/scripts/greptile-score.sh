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
# Thread resolution is a GraphQL property, not visible in the REST comment list.
owner="${repo%%/*}"; name="${repo#*/}"
unresolved=0; cursor=""
while :; do
  after=$([ -n "$cursor" ] && printf ', after:\"%s\"' "$cursor")
  page=$(gh api graphql -f query="{ repository(owner:\"$owner\", name:\"$name\") { pullRequest(number:$pr) { reviewThreads(first:100$after) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first:1) { nodes { author { login } } } } } } } }" 2>/dev/null) || break
  n=$(printf '%s' "$page" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select((.isResolved|not) and .comments.nodes[0].author.login == $ENV.GREPTILE_BOT_LOGIN)] | length')
  unresolved=$((unresolved + n))
  [ "$(printf '%s' "$page" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')" = "true" ] || break
  cursor=$(printf '%s' "$page" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
done

scored_at=$(printf '%s' "$newest" | jq -r '.at // ""')
jq -cn --arg score "$score" --arg scored_at "$scored_at" --argjson unresolved "${unresolved:-0}" --argjson review "${review:-null}" --argjson summary "${summary:-null}" --argjson comments "$comments" \
  '{score: (if $score == "" then null else ($score | tonumber) end), scored_at: (if $scored_at == "" then null else $scored_at end), unresolved: $unresolved, review_id: ($review.id // $summary.id // null), submitted_at: ($review.submitted_at // $summary.created_at // null), comments: $comments}'
