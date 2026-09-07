#!/usr/bin/env bash
# Build the svcos-factory image with every version taken from versions.env.
# Usage: snapshots/build.sh [--push <registry/prefix>]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v docker >/dev/null || { printf 'MISSING_CMD docker\n' >&2; exit 2; }

set -a
# shellcheck source=versions.env
source "$SCRIPT_DIR/versions.env"
set +a

args=()
while IFS='=' read -r key _; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  args+=(--build-arg "$key=${!key}")
done < "$SCRIPT_DIR/versions.env"

tag="${IMAGE_NAME}:${SVCOS_TEMPLATE_REF:0:12}"
docker build "${args[@]}" -t "$tag" -t "${IMAGE_NAME}:latest" "$SCRIPT_DIR"
printf 'SNAPSHOT step=build outcome=passed image=%s\n' "$tag"

if [ "${1:-}" = "--push" ]; then
  prefix="${2:?usage: build.sh --push <registry/prefix>}"
  docker tag "$tag" "$prefix/$tag"
  docker push "$prefix/$tag"
  docker image inspect "$prefix/$tag" --format '{{index .RepoDigests 0}}' | sed 's/^/SNAPSHOT digest=/'
fi
