#!/usr/bin/env bash
# Start the Machinist control plane and worker for the local runtime, in the foreground,
# with the operator environment loaded so script executors (genesis, dev) see it.
# Usage: start-local.sh </path/to/factory.env>
# Stop with Ctrl-C; both processes are terminated together.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

env_file="${1:-}"
[ -f "$env_file" ] || die "usage: start-local.sh </path/to/factory.env>"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
require_cmd machinist
require_env MACHINIST_HOME MACHINIST_LISTEN

home=$(expand_tilde "$MACHINIST_HOME")
[ -f "$home/config.toml" ] && [ -f "$home/worker.toml" ] || die "config not rendered; run install-machinist-config.sh first"

machinist start --config "$home/config.toml" --listen "$MACHINIST_LISTEN" &
cp_pid=$!
trap 'kill "$cp_pid" "${worker_pid:-}" 2>/dev/null; wait' INT TERM EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://$MACHINIST_LISTEN/api/v1/status" >/dev/null 2>&1 && break
  sleep 1
done
machinist worker start --config "$home/worker.toml" &
worker_pid=$!
log LOCAL start passed control_plane="$cp_pid" worker="$worker_pid"
wait "$worker_pid"
