#!/usr/bin/env bash
# Re-scaffold control-plane/ from the pinned SVCOS template (design §13.5 step 4), keeping the
# factory-owned modules. Never copies provider state: .env*, .doppler.yaml, .vercel, .clerk,
# node_modules, assessment output, or the template's own build cache. Copying a checkout's
# .env.local once pointed the control plane at another project's Convex deployment; this script
# exists so that cannot happen again.
# Usage: scaffold-control-plane.sh </path/to/svcos-checkout-at-pinned-ref>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd rsync node
src="${1:-}"; [ -f "$src/package.json" ] || die "usage: scaffold-control-plane.sh </path/to/svcos-checkout>"
dest="$SCRIPT_DIR/../../control-plane"
keep="$SCRIPT_DIR/../../.scaffold-keep.$$"
mkdir -p "$keep"
for f in convex/factoryTables.ts convex/factory.ts convex/githubWebhook.ts convex/bridge.ts convex/stateMachine.ts convex/gates.ts convex/projects.ts convex/runs.ts convex/decisions.ts convex/events.ts convex/lib/factoryAuth.ts scripts/validate-spec.mjs; do
  [ -f "$dest/$f" ] && mkdir -p "$keep/$(dirname "$f")" && cp "$dest/$f" "$keep/$f"
done
[ -d "$dest/factory" ] && cp -R "$dest/factory" "$keep/factory"
[ -d "$dest/app/(factory)" ] && mkdir -p "$keep/app" && cp -R "$dest/app/(factory)" "$keep/app/(factory)"

rsync -a --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude 'tsconfig.tsbuildinfo' \
  --exclude '.env*' --exclude .doppler.yaml --exclude .vercel --exclude .clerk \
  --exclude security_context --exclude security_reports --exclude threat_modeling_output \
  --exclude course-outline.tsx.txt --exclude 'docs/course' --exclude 'docs/INSTALL.md' --exclude 'docs/DEPLOYMENT-*.md' \
  --exclude convex/factoryTables.ts --exclude convex/factory.ts --exclude convex/githubWebhook.ts \
  --exclude convex/bridge.ts --exclude convex/stateMachine.ts --exclude convex/gates.ts \
  --exclude convex/projects.ts --exclude convex/runs.ts --exclude convex/decisions.ts --exclude convex/events.ts \
  --exclude convex/lib/factoryAuth.ts --exclude factory --exclude 'app/(factory)' --exclude scripts/validate-spec.mjs \
  "$src/" "$dest/"
cp -R "$keep/." "$dest/"
rm -rf "$keep"
log SCAFFOLD copy passed src="$src"
printf 'Next: merge the SVCOS schema/http changes by hand if the template changed them (see git diff), then npm install and npx tsc --noEmit.\n'
