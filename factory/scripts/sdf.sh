#!/usr/bin/env bash
# `sdf`: operator CLI for the control plane (design §13.1). Wraps `npx convex run` against the
# factory's own deployment with the admin session on this machine.
#   sdf.sh create <spec.json> [--start]   create a project (and start the line)
#   sdf.sh status <name>                  line state, recent runs, open decisions
#   sdf.sh retry <name>                   re-run the last failed stage after fixing the cause
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
require_cmd npx jq
cp_dir="$SCRIPT_DIR/../../control-plane"
[ -f "$cp_dir/.env.local" ] || die "control-plane is not installed on this machine (no .env.local)"
cmd="${1:-}"; shift || true
case "$cmd" in
  create)
    spec_path="${1:-}"; [ -f "$spec_path" ] || die "usage: sdf.sh create <spec.json> [--start]"
    "$SCRIPT_DIR/validate-spec.sh" "$spec_path" >/dev/null
    start=false; [ "${2:-}" = "--start" ] && start=true
    args=$(jq -c --argjson start "$start" '{spec: ., start: $start}' "$spec_path")
    (cd "$cp_dir" && npx convex run cli:createProject "$args")
    ;;
  retry)
    name="${1:-}"; [ -n "$name" ] || die "usage: sdf.sh retry <name>"
    (cd "$cp_dir" && npx convex run cli:retryStage "$(jq -cn --arg n "$name" '{name: $n}')")
    ;;
  set-pr)
    name="${1:-}"; pr="${2:-}"; [ -n "$name" ] && [ -n "$pr" ] || die "usage: sdf.sh set-pr <name> <number>"
    (cd "$cp_dir" && npx convex run cli:setPullRequest "$(jq -cn --arg n "$name" --argjson p "$pr" '{name: $n, pr: $p}')")
    ;;
  unblock)
    name="${1:-}"; [ -n "$name" ] || die "usage: sdf.sh unblock <name>"
    (cd "$cp_dir" && npx convex run cli:unblock "$(jq -cn --arg n "$name" '{name: $n}')")
    ;;
  set-provider)
    name="${1:-}"; kind="${2:-}"; value="${3:-}"; [ -n "$name" ] && [ -n "$kind" ] && [ -n "$value" ] || die "usage: sdf.sh set-provider <name> <kind> <value>"
    (cd "$cp_dir" && npx convex run cli:setProvider "$(jq -cn --arg n "$name" --arg k "$kind" --arg v "$value" '{name: $n, kind: $k, value: $v}')")
    ;;
  decide)
    name="${1:-}"; choice="${2:-}"; note="${3:-}"; [ -n "$name" ] && [ -n "$choice" ] || die "usage: sdf.sh decide <name> primary|secondary [note]"
    (cd "$cp_dir" && npx convex run cli:decide "$(jq -cn --arg n "$name" --arg c "$choice" --arg t "$note" '{name: $n, choice: $c} + (if $t == "" then {} else {note: $t} end)')")
    ;;
  status)
    name="${1:-}"; [ -n "$name" ] || die "usage: sdf.sh status <name>"
    (cd "$cp_dir" && npx convex run cli:status "$(jq -cn --arg n "$name" '{name: $n}')")
    ;;
  *) die "usage: sdf.sh create <spec.json> [--start] | status <name> | retry <name> | unblock <name> | set-pr <name> <number> | set-provider <name> <kind> <value> | decide <name> primary|secondary [note]" ;;
esac
