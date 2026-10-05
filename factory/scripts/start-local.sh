#!/usr/bin/env bash
# Start the whole local runtime in the foreground, with the operator environment loaded so script
# executors (genesis, dev) see it:
#   - the Machinist control plane and worker
#   - the bridge, which also brings up a local dev server for every built product
#     (factory/bridge/local-servers.mjs; LOCAL_SERVERS=off to skip them)
#   - the control-plane UI and its Convex dev deployment (control-plane/scripts/dev.mjs)
# Usage: start-local.sh </path/to/factory.env>
# Stop with Ctrl-C; every process is terminated together, product dev servers included.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

env_file="${1:-}"
[ -f "$env_file" ] || die "usage: start-local.sh </path/to/factory.env>"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
require_cmd machinist node npm
require_env MACHINIST_HOME MACHINIST_LISTEN

home=$(expand_tilde "$MACHINIST_HOME")
[ -f "$home/config.toml" ] && [ -f "$home/worker.toml" ] || die "config not rendered; run install-machinist-config.sh first"
bridge_dir="$SCRIPT_DIR/../bridge"
cp_dir="$(cd "$SCRIPT_DIR/../../control-plane" && pwd)"

# The bridge holds the processes the dev servers came from but they are detached from it, so
# stopping the bridge alone would leave them running; stop them explicitly on the way out.
cleanup() {
  trap - INT TERM EXIT
  local pids=""
  for p in "${cp_pid:-}" "${worker_pid:-}" "${bridge_pid:-}" "${ui_pid:-}"; do
    [ -n "$p" ] && pids="$pids $p"
  done
  # shellcheck disable=SC2086  # a list of pids, split on purpose
  [ -z "$pids" ] || kill $pids 2>/dev/null || true
  node "$bridge_dir/local-servers.mjs" stop
  wait
}
trap cleanup INT TERM EXIT

machinist start --config "$home/config.toml" --listen "$MACHINIST_LISTEN" &
cp_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://$MACHINIST_LISTEN/api/v1/status" >/dev/null 2>&1 && break
  sleep 1
done
machinist worker start --config "$home/worker.toml" &
worker_pid=$!

[ -d "$bridge_dir/node_modules" ] || (cd "$bridge_dir" && npm ci --no-audit --no-fund) || die "bridge dependencies failed to install"
node "$bridge_dir/bridge.mjs" &
bridge_pid=$!

# The UI gets a clean environment: factory.env carries the bridge secret, the Doppler service
# token, and LLM keys, none of which the web app needs; it reads its own .env.local.
if [ -f "$cp_dir/.env.local" ] && [ -d "$cp_dir/node_modules" ]; then
  (cd "$cp_dir" && exec env -i HOME="$HOME" USER="${USER:-}" LANG="${LANG:-en_US.UTF-8}" TERM="${TERM:-xterm}" \
    PATH="$cp_dir/node_modules/.bin:$PATH" node scripts/dev.mjs) &
  ui_pid=$!
else
  log LOCAL ui skipped reason=control-plane-not-installed
fi

log LOCAL start passed control_plane="$cp_pid" worker="$worker_pid" bridge="$bridge_pid" ui="${ui_pid:-none}"
wait "$worker_pid"
