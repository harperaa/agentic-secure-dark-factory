#!/usr/bin/env bash
# Validate one or more factory-spec documents against spec/factory-spec.schema.json.
# Usage: validate-spec.sh <spec.json> [...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd node
[ $# -ge 1 ] || die "usage: validate-spec.sh <spec.json> [...]"
schema="$SCRIPT_DIR/../../spec/factory-spec.schema.json"
node "$SCRIPT_DIR/../../control-plane/scripts/validate-spec.mjs" "$schema" "$@"
