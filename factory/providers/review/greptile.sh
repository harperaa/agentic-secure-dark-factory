#!/usr/bin/env bash
# review/greptile — Greptile GitHub App as the AI reviewer (design §3.3, §4.7). Default and EU profiles.
# Installation of the App is a human step (GitHub web UI): install it once for the account with
# "All repositories" and "auto-enable on new repositories", and every product genesis creates is
# connected automatically. Greptile retired its manual indexing API (HTTP 410 on
# /v2/repositories as of 2026-09), so nothing here runs during genesis; the review gate reads reviews
# and comments by GREPTILE_BOT_LOGIN through factory/scripts/greptile-score.sh. GREPTILE_API_KEY is
# optional and only needed for Greptile's codebase Q&A API.

review_greptile_capabilities() {
  jq -cn '{kind:"review", name:"greptile", implemented:true, verified:false,
    needs_env:["GREPTILE_BOT_LOGIN"], needs_cmd:["gh"], supports:["wait_for_review"],
    human_gate:"install the Greptile GitHub App once for the account with all repositories and auto-enable on new repositories; verify data-processing terms for EU projects"}'
}
