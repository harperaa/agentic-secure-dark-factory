#!/usr/bin/env bash
# review/greptile — Greptile GitHub App as the AI reviewer (design §3.3, §4.7). Default and EU profiles.
# Installation of the App is a human step (GitHub web UI); the review gate reads reviews and comments
# by GREPTILE_BOT_LOGIN through factory/scripts/greptile-score.sh. Nothing here runs during genesis.

review_greptile_capabilities() {
  jq -cn '{kind:"review", name:"greptile", implemented:true, verified:false,
    needs_env:["GREPTILE_BOT_LOGIN"], needs_cmd:["gh"], supports:["wait_for_review"],
    human_gate:"install the Greptile GitHub App on the product repository; verify data-processing terms for EU projects"}'
}
