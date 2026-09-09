#!/usr/bin/env bash
# identity/keycloak — refused until the SVCOS `auth-oidc` optional module exists (design R14).
# SVCOS's middleware, components, Convex auth.config.ts, and webhooks are Clerk-specific; Convex
# accepts any OIDC issuer, so only the frontend needs template code. See docs/upstream/svcos-modules.md.

identity_keycloak_capabilities() {
  jq -cn '{kind:"identity", name:"keycloak", implemented:false, verified:false, needs_env:[], needs_cmd:[], supports:[],
    reason:"requires the SVCOS optional module auth-oidc (design R14); EU profile ships with Clerk identity until it lands"}'
}
