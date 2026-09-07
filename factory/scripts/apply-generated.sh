#!/usr/bin/env bash
# Copy the factory-owned files into a product repository (design §12.5).
# Usage: apply-generated.sh </path/to/product-repo>
# Idempotent: files are overwritten only when they carry the factory marker or do not exist.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

target="${1:-}"
[ -d "$target" ] || die "usage: apply-generated.sh </path/to/product-repo>"
src="$SCRIPT_DIR/../generated"
marker="factory-managed"

while IFS= read -r -d '' file; do
  rel="${file#"$src"/}"
  dest="$target/$rel"
  mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ] && ! grep -qs "$marker" "$dest"; then
    log GENERATED "$rel" skipped reason=exists-unmanaged
    continue
  fi
  cp "$file" "$dest"
  log GENERATED "$rel" passed
done < <(find "$src" -type f -print0)
