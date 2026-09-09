#!/usr/bin/env bash
# identity/zitadel — refused until the SVCOS `auth-oidc` optional module exists (design R14).
# See identity/keycloak.sh for the reasoning and docs/upstream/svcos-modules.md for the proposal.

identity_zitadel_capabilities() {
  jq -cn '{kind:"identity", name:"zitadel", implemented:false, verified:false, needs_env:[], needs_cmd:[], supports:[],
    reason:"requires the SVCOS optional module auth-oidc (design R14); EU profile ships with Clerk identity until it lands"}'
}
