#!/usr/bin/env bash
# Shared helpers for factory scripts. Source, do not execute.
# Every script is headless: missing inputs fail fast with a machine-readable line.

set -euo pipefail

# log STAGE STEP OUTCOME [extra...] — one structured line per step boundary, on stdout,
# so Machinist records it in the run's events and the control plane can parse it.
log() {
  local stage="$1" step="$2" outcome="$3"
  shift 3
  printf '%s step=%s outcome=%s%s\n' "$stage" "$step" "$outcome" "${*:+ $*}"
}

die() {
  printf 'ERROR %s\n' "$*" >&2
  exit 1
}

# require_env VAR [VAR...] — fail with MISSING_ENV <name> if any is unset or empty.
require_env() {
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      printf 'MISSING_ENV %s\n' "$name" >&2
      exit 2
    fi
  done
}

# require_cmd CMD [CMD...] — fail with MISSING_CMD <name> if any is not on PATH.
require_cmd() {
  local name
  for name in "$@"; do
    if ! command -v "$name" >/dev/null 2>&1; then
      printf 'MISSING_CMD %s\n' "$name" >&2
      exit 2
    fi
  done
}

# spec_get JSON FIELD [DEFAULT] — read a field from a spec document with jq.
# Without DEFAULT a null or missing field fails with MISSING_ARG <field>.
spec_get() {
  local json="$1" field="$2" value
  value=$(jq -r ".$field // empty" <<<"$json")
  if [ -z "$value" ]; then
    if [ $# -ge 3 ]; then
      printf '%s' "$3"
      return 0
    fi
    printf 'MISSING_ARG %s\n' "$field" >&2
    exit 2
  fi
  printf '%s' "$value"
}

# expand_tilde PATH — resolve a leading ~ so paths from factory.env work in non-login shells.
expand_tilde() {
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# json_field JSON KEY — read a top-level key from JSON emitted by SVCOS scripts.
json_field() {
  jq -r --arg k "$2" '.[$k] // empty' <<<"$1"
}

# last_json_line TEXT — SVCOS scripts print progress then a JSON object; return the last JSON line.
last_json_line() {
  printf '%s\n' "$1" | grep -E '^\s*\{' | tail -n 1
}
