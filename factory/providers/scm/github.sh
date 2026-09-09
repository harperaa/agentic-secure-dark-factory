#!/usr/bin/env bash
# scm/github — GitHub via gh and SVCOS deploy.mjs github-setup / lockdown-main.sh. Default and EU
# profiles. Verified 2026-09-07. Invocations unchanged from the pre-adapter genesis (design G7).
#
# Products carry both `origin` and `upstream` (the template), so every gh call in a product
# checkout must name the repository: set_default persists it and GH_REPO pins the SVCOS calls.

scm_github_capabilities() {
  jq -cn '{kind:"scm", name:"github", implemented:true, verified:true,
    needs_env:["LOCKDOWN_MODE_DARK","LOCKDOWN_MODE_GRAY","FACTORY_REQUIRED_CONTEXTS"], needs_cmd:["gh","git"],
    supports:["create_repo","has_repo","set_default","repo_url","has_secret","protect"]}'
}

# scm_github_has_repo OWNER NAME — origin already points at the product repository.
scm_github_has_repo() {
  local origin
  origin=$(git remote get-url origin 2>/dev/null || true)
  [[ "$origin" == *"/$1/$2"* || "$origin" == *":$1/$2"* ]]
}

# scm_github_create_repo OWNER NAME — SVCOS github-setup (creates, sets origin, pushes main).
scm_github_create_repo() {
  run_svcos github-setup node scripts/deploy.mjs github-setup --repo-name="$2" --owner="$1"
}

# scm_github_set_default OWNER NAME — with origin and upstream both present, gh would otherwise
# resolve upstream (the template) as the default repository for every later gh call.
scm_github_set_default() { gh repo set-default "$1/$2"; }

scm_github_repo_url() { gh repo view "$1/$2" --json url -q .url; }

# scm_github_has_secret OWNER/REPO KEY — an Actions secret with that name exists.
scm_github_has_secret() {
  gh secret list --repo "$1" --json name -q '.[].name' 2>/dev/null | grep -qx "$2"
}

# scm_github_protect OWNER/REPO solo|team CONTEXTS — SVCOS lockdown, then the factory's contexts.
scm_github_protect() {
  local repo="$1" lockdown_mode="$2" contexts="$3"
  if [ "$lockdown_mode" = "solo" ]; then
    GH_REPO="$repo" ./scripts/lockdown-main.sh --solo
  else
    GH_REPO="$repo" ./scripts/lockdown-main.sh
  fi
  "$FACTORY_ROOT/factory/scripts/protect-main.sh" "$repo" "$contexts"
}
