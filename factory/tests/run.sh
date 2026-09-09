#!/usr/bin/env bash
# Run every factory/tests/*.test.sh in its own process with the fake CLIs on PATH.
# Exit non-zero when any test file fails. No network, no real providers.

set -euo pipefail
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for t in "$TESTS_DIR"/*.test.sh; do
  printf '== %s\n' "$(basename "$t")"
  if ! bash "$t"; then status=1; fi
done
[ "$status" -eq 0 ] && printf 'TESTS outcome=passed\n' || printf 'TESTS outcome=failed\n'
exit "$status"
