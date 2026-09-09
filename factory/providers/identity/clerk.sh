#!/usr/bin/env bash
# identity/clerk — Clerk via SVCOS setup.mjs (accountless dev app or supplied keys). Default profile.
# Verified 2026-09-07. SVCOS invocations unchanged from the pre-adapter genesis (design G7).

identity_clerk_capabilities() {
  jq -cn '{kind:"identity", name:"clerk", implemented:true, verified:true,
    needs_env:[], needs_cmd:[], supports:["create_app","has_app","configure"]}'
}

identity_clerk_has_app() { secrets_has NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY; }

# identity_clerk_create_app NAME EMAIL [PK SK] — run SVCOS init. The full output (claim URL
# included) is printed so the run record has it even if a later step fails; the compact result
# is left in SVCOS_JSON. A "Warning: Doppler push failed" step means the keys never reached the
# secrets broker, which is a failure for the factory even though SVCOS reports success.
identity_clerk_create_app() {
  local name="$1" email="$2" pk="${3:-}" sk="${4:-}" warning
  local args=(init "--site-name=$name" "--admin-email=$email")
  if [ -n "$pk" ]; then
    [ -n "$sk" ] || { printf 'MISSING_ARG clerk.secret_key_ref\n' >&2; exit 2; }
    args+=("--clerk-pk=$pk" "--clerk-sk=$sk")
  fi
  run_svcos init node scripts/setup.mjs "${args[@]}"
  warning=$(jq -r '[(.steps // [])[], (.warnings // [])[]] | map(select(test("(?i)doppler.*(fail|warning)|warning.*doppler"))) | first // empty' <<<"$SVCOS_JSON")
  if [ -n "$warning" ]; then
    printf 'ERROR step=init reason=secrets-push-failed detail=%s\n' "$warning" >&2
    exit 1
  fi
}

# identity_clerk_configure EMAIL — webhook + Convex env vars via SVCOS configure.
identity_clerk_configure() {
  run_svcos configure node scripts/setup.mjs configure --admin-email="$1"
}
