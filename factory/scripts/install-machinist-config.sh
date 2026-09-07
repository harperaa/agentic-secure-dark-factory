#!/usr/bin/env bash
# Render factory/config/*.tmpl with the operator environment into MACHINIST_HOME and fetch
# Machinist's own foreman/shepherd prompts at the pinned release (used verbatim, design G7).
# Re-runnable. Does not restart services. Repositories registered with register-repository.sh
# live in $MACHINIST_HOME/factory-repositories.toml and are re-appended on every render.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd curl envsubst
require_env FACTORY_ROOT FACTORY_WORKSPACE MACHINIST_HOME MACHINIST_URL MACHINIST_LISTEN \
  MACHINIST_TOKEN_FILE MACHINIST_VERSION MACHINIST_WORKER_NAME MACHINIST_MAX_CONCURRENT_JOBS \
  MACHINIST_REQUEST_LABEL SANDBOX_BACKEND SANDBOX_SNAPSHOT

home=$(expand_tilde "$MACHINIST_HOME")
token_file=$(expand_tilde "$MACHINIST_TOKEN_FILE")
workspace=$(expand_tilde "$FACTORY_WORKSPACE")
mkdir -p "$home/server" "$home/worker" "$home/prompts" "$(dirname "$token_file")"
export MACHINIST_HOME="$home" MACHINIST_TOKEN_FILE="$token_file" FACTORY_WORKSPACE="$workspace"

vars='$FACTORY_ROOT $FACTORY_WORKSPACE $MACHINIST_HOME $MACHINIST_URL $MACHINIST_LISTEN $MACHINIST_TOKEN_FILE $MACHINIST_WORKER_NAME $MACHINIST_MAX_CONCURRENT_JOBS $MACHINIST_REQUEST_LABEL $SANDBOX_BACKEND $SANDBOX_SNAPSHOT'
envsubst "$vars" < "$SCRIPT_DIR/../config/config.toml.tmpl" > "$home/config.toml"
envsubst "$vars" < "$SCRIPT_DIR/../config/worker.toml.tmpl" > "$home/worker.toml"
if [ -s "$home/factory-repositories.toml" ]; then
  printf '\n# --- Registered product repositories (factory-repositories.toml) ---\n' >> "$home/worker.toml"
  cat "$home/factory-repositories.toml" >> "$home/worker.toml"
fi
log INSTALL config passed path="$home"

cp "$SCRIPT_DIR/../commands/assess.md" "$SCRIPT_DIR/../commands/greptile-fix.md" \
   "$SCRIPT_DIR/../commands/triage.md" "$home/prompts/"
base="https://raw.githubusercontent.com/owainlewis/machinist/$MACHINIST_VERSION/examples/prompts"
for p in foreman shepherd; do
  curl -fsSL "$base/$p.md" -o "$home/prompts/$p.md"
done
log INSTALL prompts passed machinist="$MACHINIST_VERSION"

if [ ! -s "$token_file" ]; then
  ( umask 077; head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$token_file" )
  log INSTALL worker-token passed path="$token_file"
else
  log INSTALL worker-token skipped
fi
