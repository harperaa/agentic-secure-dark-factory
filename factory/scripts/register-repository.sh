#!/usr/bin/env bash
# Register a repository the worker may run in. Appends to factory-repositories.toml and to the
# rendered worker.toml, so the registration survives re-renders.
# Usage: register-repository.sh <name> </absolute/path>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env MACHINIST_HOME
name="${1:-}"; path="${2:-}"
[ -n "$name" ] && [ -d "$path" ] || die "usage: register-repository.sh <name> </absolute/path>"
[[ "$path" = /* ]] || die "path must be absolute"
home=$(expand_tilde "$MACHINIST_HOME")
[ -f "$home/worker.toml" ] || die "worker.toml not rendered; run install-machinist-config.sh first"
registry="$home/factory-repositories.toml"
touch "$registry"
if grep -q "^\[repositories\.$name\]" "$registry" "$home/worker.toml"; then
  log REGISTER "$name" skipped reason=exists
  exit 0
fi
entry=$(printf '\n[repositories.%s]\npath = "%s"\n' "$name" "$path")
printf '%s\n' "$entry" >> "$registry"
printf '%s\n' "$entry" >> "$home/worker.toml"
log REGISTER "$name" passed path="$path"
