#!/usr/bin/env bash
# CI guard (design R12): no factory-path prompt may contain an interactive question.
# Scans factory/commands and factory/generated; exits 1 on any hit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$SCRIPT_DIR/../.."
status=0
while IFS= read -r hit; do
  printf 'INTERACTIVE_PROMPT %s\n' "$hit" >&2
  status=1
done < <(grep -rn --include='*.md' --include='*.yml' --include='*.yaml' --include='*.sh' \
  -e 'AskUserQuestion' "$root/factory/commands" "$root/factory/generated" || true)
[ "$status" -eq 0 ] && printf 'GUARD askuserquestion outcome=passed\n'
exit "$status"
