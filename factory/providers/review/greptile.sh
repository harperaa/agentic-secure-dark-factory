#!/usr/bin/env bash
# review/greptile — Greptile GitHub App as the AI reviewer (design §3.3, §4.7). Default and EU profiles.
# Installation of the App is a human step (GitHub web UI), scoped either to selected repositories
# (add each product after genesis; nothing else on the account is exposed) or to all repositories
# with auto-enable (every product connects automatically, and so does everything else on the
# account). A product without the App must declare review=none explicitly; there is no fallback. Greptile retired its manual indexing API (HTTP 410 on
# /v2/repositories as of 2026-09), so nothing here runs during genesis; the review gate reads reviews
# and comments by GREPTILE_BOT_LOGIN through factory/scripts/greptile-score.sh. GREPTILE_API_KEY is
# optional and only needed for Greptile's codebase Q&A API.

review_greptile_capabilities() {
  jq -cn '{kind:"review", name:"greptile", implemented:true, verified:false,
    needs_env:["GREPTILE_BOT_LOGIN"], needs_cmd:["gh"], supports:["wait_for_review"],
    human_gate:"install the Greptile GitHub App on the product repository (or account-wide if the account holds only factory products); set review=none explicitly where it is absent; verify data-processing terms for EU projects"}'
}
