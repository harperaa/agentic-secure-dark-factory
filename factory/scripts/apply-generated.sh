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
# Files the product owns after the first write: the factory seeds them and never overwrites.
write_once='.secrets.baseline security_context/accepted.json'

while IFS= read -r -d '' file; do
  rel="${file#"$src"/}"
  dest="$target/$rel"
  mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ]; then
    case " $write_once " in
      *" $rel "*) log GENERATED "$rel" skipped reason=write-once; continue ;;
    esac
    if ! grep -qs "$marker" "$dest"; then
      log GENERATED "$rel" skipped reason=exists-unmanaged
      continue
    fi
  fi
  cp "$file" "$dest"
  log GENERATED "$rel" passed
done < <(find "$src" -type f -print0)
