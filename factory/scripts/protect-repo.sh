#!/usr/bin/env bash
# Re-apply a product's branch protection for the mode it now runs in (design §12.2 #1).
# Usage: protect-repo.sh <owner/repo> <dark|gray> <product-name> <providers-json>
# Same call genesis makes at step 13, run from the product's checkout under FACTORY_WORKSPACE
# because the template's lockdown script addresses the repository it is run in. Queued by the
# control plane as a `protect` effect whenever a project's effective mode changes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=../providers/load.sh
source "$SCRIPT_DIR/../providers/load.sh"

repo="${1:-}"; mode="${2:-}"; name="${3:-}"; providers="${4:-{\}}"
[ -n "$repo" ] && [ -n "$name" ] && { [ "$mode" = "dark" ] || [ "$mode" = "gray" ]; } \
  || die "usage: protect-repo.sh <owner/repo> <dark|gray> <product-name> <providers-json>"
require_cmd gh jq
require_env FACTORY_ROOT FACTORY_WORKSPACE LOCKDOWN_MODE_DARK LOCKDOWN_MODE_GRAY FACTORY_REQUIRED_CONTEXTS

checkout="$(expand_tilde "$FACTORY_WORKSPACE")/$name"
[ -f "$checkout/scripts/lockdown-main.sh" ] || die "no product checkout with scripts/lockdown-main.sh at $checkout"
providers_load "$(jq -cn --argjson p "$providers" '{providers: ($p + {profile: ($p.profile // "default")})}')"

lockdown_mode=$([ "$mode" = "dark" ] && printf '%s' "$LOCKDOWN_MODE_DARK" || printf '%s' "$LOCKDOWN_MODE_GRAY")
log PROTECT lockdown started repo="$repo" mode="$mode" lockdown="$lockdown_mode"
cd "$checkout" || die "cannot enter $checkout"
scm_protect "$repo" "$lockdown_mode" "$FACTORY_REQUIRED_CONTEXTS"
log PROTECT lockdown passed repo="$repo" mode="$mode" lockdown="$lockdown_mode"
