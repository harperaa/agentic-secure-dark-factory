#!/usr/bin/env bash
# doctor.sh — read-only onboarding discovery for a fresh clone of the factory.
#
# Reports the candidate values a cloner cannot guess (GitHub owner, VERCEL_SCOPE, CONVEX_TEAM
# slug, Doppler workplace) and which required CLIs and logins are missing. Never prints a secret.
#
# Usage:
#   factory/scripts/doctor.sh                 report only
#   factory/scripts/doctor.sh --write <path>  also write a filled-in copy of factory.env.example
#                                             to <path> (refuses to overwrite an existing file)
#
# Discovery is a suggestion, not a default: when a value has several candidates the env file is
# left blank for that key and the candidates are listed (design §4.10 rule 3).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

write_path=""
case "${1:-}" in
  --write) write_path="${2:-}"; [ -n "$write_path" ] || die "usage: doctor.sh [--write <path>]" ;;
  "") ;;
  *) die "usage: doctor.sh [--write <path>]" ;;
esac

status=0
missing_cmds=()
for c in git node npm npx gh jq doppler claude machinist; do
  if command -v "$c" >/dev/null 2>&1; then
    printf 'DOCTOR cmd=%s outcome=present\n' "$c"
  else
    printf 'DOCTOR cmd=%s outcome=missing\n' "$c"
    missing_cmds+=("$c")
  fi
done
command -v codex >/dev/null 2>&1 && printf 'DOCTOR cmd=codex outcome=present\n' || \
  printf 'DOCTOR cmd=codex outcome=missing note=optional (point the shepherd command at the claude executor)\n'

# --- GitHub -------------------------------------------------------------------------------
gh_owner=""; gh_orgs=""
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh_owner=$(gh api user --jq .login 2>/dev/null || true)
  gh_orgs=$(gh api user/orgs --jq '.[].login' 2>/dev/null | tr '\n' ' ' || true)
  printf 'DOCTOR login=github outcome=ok user=%s orgs=[%s]\n' "$gh_owner" "${gh_orgs% }"
else
  printf 'DOCTOR login=github outcome=missing hint="gh auth login -s repo,workflow,read:org"\n'
  status=1
fi

# --- Vercel -------------------------------------------------------------------------------
vercel_bin=""
if command -v vercel >/dev/null 2>&1; then vercel_bin="vercel"; elif npx --no-install vercel --version >/dev/null 2>&1; then vercel_bin="npx --no-install vercel"; fi
vercel_scopes=()
if [ -n "$vercel_bin" ] && $vercel_bin whoami >/dev/null 2>&1; then
  # The Vercel CLI prints its table on stderr; take the first column after the "id" header.
  while IFS= read -r line; do
    [ -n "$line" ] && vercel_scopes+=("$line")
  done < <($vercel_bin teams ls 2>&1 | awk 'seen && $1 != "" {print $1} $1 == "id" {seen=1}' | sed 's/^>//' | grep -vE '^$' || true)
  printf 'DOCTOR login=vercel outcome=ok user=%s scopes=[%s]\n' "$($vercel_bin whoami 2>&1 | tail -n 1)" "${vercel_scopes[*]}"
else
  printf 'DOCTOR login=vercel outcome=missing hint="npm i -g vercel && vercel login"\n'
  status=1
fi

# --- Convex -------------------------------------------------------------------------------
convex_teams=()
if command -v npx >/dev/null 2>&1; then
  # The Convex CLI reports on stderr; --yes falls back to a one-off download when it is not local.
  convex_status=$(npx --no-install convex login status 2>&1 || npx --yes convex login status 2>&1 || true)
  if printf '%s' "$convex_status" | grep -q 'Logged in'; then
    while IFS= read -r slug; do
      [ -n "$slug" ] && convex_teams+=("$slug")
    done < <(printf '%s\n' "$convex_status" | grep -oE '\(([a-z0-9-]+)\)$' | tr -d '()')
    printf 'DOCTOR login=convex outcome=ok teams=[%s]\n' "${convex_teams[*]}"
  else
    printf 'DOCTOR login=convex outcome=missing hint="npx convex login"\n'
    status=1
  fi
fi

# --- Doppler ------------------------------------------------------------------------------
doppler_workplace=""
if command -v doppler >/dev/null 2>&1 && me=$(doppler me --json 2>/dev/null); then
  doppler_workplace=$(jq -r '.workplace.name // empty' <<<"$me")
  printf 'DOCTOR login=doppler outcome=ok workplace="%s" token_type=%s\n' "$doppler_workplace" "$(jq -r '.type // "unknown"' <<<"$me")"
else
  printf 'DOCTOR login=doppler outcome=missing hint="doppler login"\n'
  status=1
fi

# --- Claude -------------------------------------------------------------------------------
if command -v claude >/dev/null 2>&1 && claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  printf 'DOCTOR login=claude outcome=ok\n'
else
  printf 'DOCTOR login=claude outcome=missing hint="claude login"\n'
  status=1
fi

# --- Candidates ---------------------------------------------------------------------------
pick_one() { [ "$#" -eq 1 ] && printf '%s' "$1"; }
owner_candidates=("$gh_owner")
for o in $gh_orgs; do owner_candidates+=("$o"); done
printf 'DOCTOR candidates github_owner=[%s] VERCEL_SCOPE=[%s] CONVEX_TEAM=[%s] doppler_workplace=[%s]\n' \
  "${owner_candidates[*]}" "${vercel_scopes[*]}" "${convex_teams[*]}" "$doppler_workplace"
[ "${#missing_cmds[@]}" -eq 0 ] || printf 'DOCTOR missing_cmds=[%s]\n' "${missing_cmds[*]}"

# --- Optional write -----------------------------------------------------------------------
if [ -n "$write_path" ]; then
  [ -e "$write_path" ] && die "refusing to overwrite $write_path"
  root="$(cd "$SCRIPT_DIR/../.." && pwd)"
  scope=$(pick_one "${vercel_scopes[@]}" || true)
  team=$(pick_one "${convex_teams[@]}" || true)
  ws=$(expand_tilde "${FACTORY_WORKSPACE:-$HOME/Code/factory-workspace}")
  sed -e "s#^FACTORY_ROOT=.*#FACTORY_ROOT=$root#" \
      -e "s#^FACTORY_WORKSPACE=.*#FACTORY_WORKSPACE=$ws#" \
      -e "s#^VERCEL_SCOPE=.*#VERCEL_SCOPE=$scope#" \
      -e "s#^CONVEX_TEAM=.*#CONVEX_TEAM=$team#" \
      "$root/factory/config/factory.env.example" > "$write_path"
  chmod 600 "$write_path"
  printf 'DOCTOR wrote=%s VERCEL_SCOPE=%s CONVEX_TEAM=%s note="blank values have several candidates; choose one"\n' \
    "$write_path" "${scope:-<choose>}" "${team:-<choose>}"
fi
exit "$status"
