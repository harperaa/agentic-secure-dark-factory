#!/usr/bin/env bash
# `sdf`: operator CLI for the control plane (design §13.1). Wraps `npx convex run` against the
# factory's own deployment with the admin session on this machine.
#   sdf.sh create <spec.json> [--start]   create a project (and start the line)
#   sdf.sh status <name>                  line state, recent runs, open decisions
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
  status)
    name="${1:-}"; [ -n "$name" ] || die "usage: sdf.sh status <name>"
    (cd "$cp_dir" && npx convex run cli:status "$(jq -cn --arg n "$name" '{name: $n}')")
    ;;
  *) die "usage: sdf.sh create <spec.json> [--start] | status <name>" ;;
esac
