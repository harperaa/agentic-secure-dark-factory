#!/usr/bin/env bash
# Provider adapter loader (design §4.11). Source after lib/common.sh.
#
#   providers_load "$SPEC_JSON"   resolve the spec's providers block against the profile defaults,
#                                 source one module per kind, and define the generic dispatchers
#   providers_gate                refuse (NEEDS_HUMAN reason=...) when any selected adapter is not
#                                 implemented or its required env/CLIs are missing
#   providers_capabilities        print one JSON object per selected adapter
#
# A module lives at factory/providers/<kind>/<name>.sh and defines functions named
# <kind>_<name_with_underscores>_<verb> plus <kind>_<name>_capabilities. The dispatchers below
# (hosting_link, secrets_has, ...) forward to the selected module, so genesis.sh and
# deploy-dev.sh never name a provider.

PROVIDERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROVIDER_KINDS="hosting identity secrets backend payments scm llm review"
PROVIDER_VERBS="bootstrap bootstrapped has get set sync_local synced ci_token has_ci_token export_env mode \
  create_app has_app configure create_project has_project deploy_functions url \
  link is_linked write_config config_current set_env deploy promote \
  create_repo has_repo set_default repo_url has_secret protect step_name env"

# profile_default PROFILE KIND — the adapter a profile uses when the spec does not name one.
profile_default() {
  case "$1:$2" in
    default:hosting) printf vercel ;;
    default:identity) printf clerk ;;
    default:secrets) printf doppler ;;
    default:backend) printf convex-cloud ;;
    default:payments) printf clerk-billing ;;
    default:scm) printf github ;;
    default:llm) printf anthropic ;;
    default:review) printf greptile ;;
    eu:hosting) printf scaleway ;;
    eu:identity) printf clerk ;;          # design R14: EU data plane, Clerk identity until auth-oidc exists
    eu:secrets) printf infisical ;;
    eu:backend) printf convex-selfhosted ;;
    eu:payments) printf clerk-billing ;;  # design R14
    eu:scm) printf github ;;
    eu:llm) printf anthropic-bedrock-eu ;;
    eu:review) printf greptile ;;
    *) return 1 ;;
  esac
}

# _provider_var KIND — name of the variable holding the selected adapter for a kind.
_provider_var() {
  printf 'PROVIDER_%s' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
}

# providers_load SPEC_JSON — sets PROVIDER_<KIND> variables and sources the modules.
providers_load() {
  local spec="$1" kind name profile var
  profile=$(jq -r '.providers.profile // empty' <<<"$spec")
  [ -n "$profile" ] || { printf 'MISSING_ARG providers.profile\n' >&2; exit 2; }
  PROVIDER_PROFILE="$profile"
  export PROVIDER_PROFILE
  for kind in $PROVIDER_KINDS; do
    name=$(jq -r --arg k "$kind" '.providers[$k] // empty' <<<"$spec")
    if [ -z "$name" ]; then
      name=$(profile_default "$profile" "$kind") || die "NEEDS_HUMAN reason=profile-unknown profile=$profile"
    fi
    var=$(_provider_var "$kind")
    printf -v "$var" '%s' "$name"
    export "${var?}"
    if [ -f "$PROVIDERS_DIR/$kind/$name.sh" ]; then
      # shellcheck disable=SC1090
      source "$PROVIDERS_DIR/$kind/$name.sh"
    fi
  done
  _providers_define_dispatchers
}

# provider_fn KIND VERB — name of the selected module's function for a verb.
provider_fn() {
  local kind="$1" verb="$2" var name
  var=$(_provider_var "$kind")
  name="${!var}"
  printf '%s_%s_%s' "$kind" "${name//-/_}" "$verb"
}

# provider_call KIND VERB [args...] — call the selected module's function; fail if absent.
provider_call() {
  local kind="$1" verb="$2" fn
  shift 2
  fn=$(provider_fn "$kind" "$verb")
  if ! declare -F "$fn" >/dev/null; then
    printf 'ERROR provider=%s verb=%s reason=unsupported\n' "$kind" "$verb" >&2
    exit 1
  fi
  "$fn" "$@"
}

# provider_supports KIND VERB — true when the selected module defines the verb.
provider_supports() {
  declare -F "$(provider_fn "$1" "$2")" >/dev/null
}

# providers_capabilities — one JSON object per selected adapter (modules without a file
# report implemented=false so the gate can name the gap).
providers_capabilities() {
  local kind fn var name
  for kind in $PROVIDER_KINDS; do
    var=$(_provider_var "$kind")
    name="${!var}"
    fn=$(provider_fn "$kind" capabilities)
    if declare -F "$fn" >/dev/null; then
      "$fn"
    else
      jq -cn --arg k "$kind" --arg n "$name" \
        '{kind:$k, name:$n, implemented:false, verified:false, reason:"no adapter module"}'
    fi
  done
}

# providers_gate — exit with NEEDS_HUMAN naming the first unmet requirement (design §4.11 rules).
# Implementation gaps are reported before environment gaps: an adapter that cannot exist is the
# more fundamental problem than a variable the operator has not set yet.
providers_gate() {
  local caps line kind name implemented reason envs cmds e c
  caps=$(providers_capabilities)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    kind=$(jq -r .kind <<<"$line"); name=$(jq -r .name <<<"$line")
    implemented=$(jq -r 'if .implemented == true then "true" else "false" end' <<<"$line")
    if [ "$implemented" != "true" ]; then
      reason=$(jq -r '.reason // "not implemented"' <<<"$line")
      die "NEEDS_HUMAN reason=provider-unsupported kind=$kind name=$name detail=\"$reason\""
    fi
  done <<<"$caps"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    kind=$(jq -r .kind <<<"$line"); name=$(jq -r .name <<<"$line")
    envs=$(jq -r '(.needs_env // [])[]' <<<"$line")
    for e in $envs; do
      [ -n "${!e:-}" ] || die "NEEDS_HUMAN reason=provider-env-missing kind=$kind name=$name env=$e"
    done
    cmds=$(jq -r '(.needs_cmd // [])[]' <<<"$line")
    for c in $cmds; do
      command -v "$c" >/dev/null 2>&1 || die "NEEDS_HUMAN reason=provider-cmd-missing kind=$kind name=$name cmd=$c"
    done
  done <<<"$caps"
}

# Generic dispatchers: <kind>_<verb> forwards to the selected module; genesis.sh only calls these.
_providers_define_dispatchers() {
  local kind verb
  for kind in $PROVIDER_KINDS; do
    for verb in $PROVIDER_VERBS; do
      eval "${kind}_${verb}() { provider_call ${kind} ${verb} \"\$@\"; }"
      eval "${kind}_supports_${verb}() { provider_supports ${kind} ${verb}; }"
    done
  done
}
