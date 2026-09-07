#!/usr/bin/env bash
# Submit one job to the Machinist control plane over its bearer-token API.
# Usage: submit-job.sh --command=<name> --repository=<name> (--prompt=<text> | --prompt-file=<path>) [--model=<alias>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd curl jq
require_env MACHINIST_URL MACHINIST_TOKEN_FILE

command_name=""; repository=""; prompt=""; prompt_file=""; model=""
for arg in "$@"; do
  case "$arg" in
    --command=*) command_name="${arg#*=}" ;;
    --repository=*) repository="${arg#*=}" ;;
    --prompt=*) prompt="${arg#*=}" ;;
    --prompt-file=*) prompt_file="${arg#*=}" ;;
    --model=*) model="${arg#*=}" ;;
    *) die "unknown argument: $arg" ;;
  esac
done
[ -n "$command_name" ] || { printf 'MISSING_ARG command\n' >&2; exit 2; }
[ -n "$repository" ] || { printf 'MISSING_ARG repository\n' >&2; exit 2; }
if [ -n "$prompt_file" ]; then prompt=$(cat "$prompt_file"); fi
[ -n "$prompt" ] || { printf 'MISSING_ARG prompt\n' >&2; exit 2; }

token=$(cat "$(expand_tilde "$MACHINIST_TOKEN_FILE")")
body=$(jq -cn --arg p "$prompt" --arg r "$repository" --arg c "$command_name" --arg m "$model" \
  '{prompt: $p, repository: $r, command: $c} + (if $m == "" then {} else {model: $m} end)')
curl -fsS -X POST "$MACHINIST_URL/api/v1/jobs" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  --data "$body"
printf '\n'
