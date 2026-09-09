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
  if [ "$1" = "~" ]; then
    printf '%s' "$HOME"
  elif [ "${1#\~/}" != "$1" ]; then
    printf '%s/%s' "$HOME" "${1#\~/}"
  else
    printf '%s' "$1"
  fi
}

# json_field JSON KEY — read a top-level key from JSON emitted by SVCOS scripts.
json_field() {
  jq -r --arg k "$2" '.[$k] // empty' <<<"$1"
}

# last_json_line TEXT — SVCOS scripts print progress then a (pretty-printed) JSON object;
# return that final object compacted to one line, or nothing if none parses.
last_json_line() {
  local text="$1" start
  start=$(printf '%s\n' "$text" | grep -nE '^\{' | tail -n 1 | cut -d: -f1)
  [ -n "$start" ] || return 0
  printf '%s\n' "$text" | tail -n +"$start" | jq -c . 2>/dev/null || true
}

# get_setting KEY — print a non-secret setting's value from Doppler dev or .env.local.
get_setting() {
  local key="$1"
  if [ -f .doppler.yaml ]; then
    doppler secrets get "$key" --plain 2>/dev/null || true
  else
    grep -s "^$key=" .env.local | cut -d= -f2- || true
  fi
}

# assert_success JSON STEP — SVCOS scripts exit 0 even when they report {"success": false};
# fail the stage with the script's own error text instead of carrying on.
assert_success() {
  local json="$1" step="$2"
  if [ -z "$json" ]; then
    printf 'ERROR step=%s reason=no-json-result\n' "$step" >&2
    exit 1
  fi
  # jq's // treats false as missing, so test equality explicitly.
  if [ "$(jq -r 'if .success == false then "false" else "true" end' <<<"$json")" = "false" ]; then
    printf 'ERROR step=%s reason=%s detail=%s\n' "$step" \
      "$(jq -r '.error // "unknown"' <<<"$json")" "$(jq -r '.detail // .hint // "" | tostring' <<<"$json" | tr '\n' ' ' | cut -c1-300)" >&2
    exit 1
  fi
}

# has_setting KEY — true when the product already has KEY configured: in the Doppler dev
# config when the repo is in Doppler mode (.doppler.yaml), otherwise in .env.local.
has_setting() {
  local key="$1"
  if [ -f .doppler.yaml ]; then
    [ -n "$(doppler secrets get "$key" --plain 2>/dev/null || true)" ]
  else
    grep -qs "^$key=" .env.local
  fi
}
