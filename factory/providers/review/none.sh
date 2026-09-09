#!/usr/bin/env bash
# review/none — no AI reviewer. The review gate is CI only and the control plane marks every PR
# forced gray ("no reviewer configured"), so nothing auto-merges (design §4.7, §4.9). Use it for
# products where the Greptile GitHub App has not been installed yet.

review_none_capabilities() {
  jq -cn '{kind:"review", name:"none", implemented:true, verified:true,
    needs_env:[], needs_cmd:[], supports:[],
    note:"CI-only review gate; the control plane never auto-merges without a reviewer"}'
}
