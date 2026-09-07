#!/usr/bin/env bash
# Resolve a secret reference through the secrets adapter and print the value.
# Reference forms:
#   doppler://<project>/<config>/<NAME>
#   env://<NAME>
# Never echoes the reference or value anywhere but stdout; callers must not log it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ref="${1:-}"
[ -n "$ref" ] || { printf 'MISSING_ARG secret_ref\n' >&2; exit 2; }

case "$ref" in
  doppler://*)
    require_cmd doppler
    rest="${ref#doppler://}"
    project="${rest%%/*}"; rest="${rest#*/}"
    config="${rest%%/*}"; secret="${rest#*/}"
    doppler secrets get "$secret" --project "$project" --config "$config" --plain
    ;;
  env://*)
    name="${ref#env://}"
    require_env "$name"
    printf '%s' "${!name}"
    ;;
  *)
    die "unsupported secret reference scheme: ${ref%%:*}"
    ;;
esac
