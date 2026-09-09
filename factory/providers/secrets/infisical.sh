#!/usr/bin/env bash
# secrets/infisical — Infisical (EU cloud or self-hosted) with SVCOS in its legacy `env` mode
# (design §4.11 secrets row). Real implementation, NOT verified against Infisical here.
#
# Infisical's CLI cannot create projects, so the project and its environments are created by a
# person and named in the environment (INFISICAL_PROJECT_ID). The adapter keeps SVCOS's
# .env.local in the shape the scripts expect by exporting the dev environment into it, and pushes
# what SVCOS writes locally back up (sync_local). No CI service token is created: Infisical's
# machine identities are provisioned by a person, so ci_token is not in `supports` and genesis
# skips that step with a reason.

secrets_infisical_capabilities() {
  jq -cn '{kind:"secrets", name:"infisical", implemented:true, verified:false, secrets_mode:"env",
    needs_env:["INFISICAL_PROJECT_ID","INFISICAL_API_URL"], optional_env:["INFISICAL_TOKEN","INFISICAL_ENV"],
    needs_cmd:["infisical"], supports:["bootstrap","has","get","set","sync_local","export_env"],
    human_gate:"create the Infisical project and a machine identity for CI; set INFISICAL_PROJECT_ID", residency:"EU"}'
}

secrets_infisical_mode() { printf env; }

secrets_infisical_step_name() {
  case "$1" in
    bootstrap) printf infisical-bootstrap ;;
    sync_local) printf infisical-sync ;;
    ci_token) printf infisical-ci-token ;;
    *) printf 'infisical-%s' "$1" ;;
  esac
}

_infisical_env() { printf '%s' "${INFISICAL_ENV:-dev}"; }
_infisical_common() { printf -- '--projectId=%s --env=%s --domain=%s' "$INFISICAL_PROJECT_ID" "$(_infisical_env)" "$INFISICAL_API_URL"; }

secrets_infisical_bootstrapped() { [ -f .infisical.json ]; }

# secrets_infisical_bootstrap NAME — pin the checkout to the project and write .env.local from it.
secrets_infisical_bootstrap() {
  if [ -z "${INFISICAL_TOKEN:-}" ] && ! infisical user get --domain="$INFISICAL_API_URL" >/dev/null 2>&1; then
    printf 'MISSING_ENV INFISICAL_TOKEN (or an Infisical CLI login for this account)\n' >&2
    exit 2
  fi
  jq -n --arg p "$INFISICAL_PROJECT_ID" --arg e "$(_infisical_env)" '{workspaceId:$p, defaultEnvironment:$e}' > .infisical.json
  secrets_infisical_export_env "$(_infisical_env)" > .env.local
}

secrets_infisical_has() { [ -n "$(secrets_infisical_get "$1")" ]; }

secrets_infisical_get() {
  # shellcheck disable=SC2046
  infisical secrets get "$1" $(_infisical_common) --plain 2>/dev/null || grep -s "^$1=" .env.local | cut -d= -f2- || true
}

secrets_infisical_set() {
  # shellcheck disable=SC2046
  infisical secrets set "$1=$2" $(_infisical_common) >/dev/null
}

# secrets_infisical_sync_local — push every key SVCOS wrote to .env.local up to Infisical.
secrets_infisical_sync_local() {
  local line key value pushed=0
  [ -f .env.local ] || { jq -cn '{success:true, pushed:0}'; return 0; }
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"; value="${line#*=}"
    [ -n "$key" ] || continue
    secrets_infisical_set "$key" "$value"
    pushed=$((pushed + 1))
  done < .env.local
  jq -cn --argjson n "$pushed" '{success:true, pushed:$n}'
}

# secrets_infisical_export_env [ENV] — dotenv lines in the shape SVCOS's .env.local uses.
secrets_infisical_export_env() {
  infisical export --format=dotenv --projectId="$INFISICAL_PROJECT_ID" --env="${1:-$(_infisical_env)}" --domain="$INFISICAL_API_URL"
}
