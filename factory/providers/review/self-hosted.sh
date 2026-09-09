#!/usr/bin/env bash
# review/self-hosted — a reviewer prompt run as a Machinist job instead of a third-party App
# (design §4.11 review row). The prompt does not exist yet; the adapter is declared so the EU
# profile can name it and the gate refuses honestly until it is built.

review_self_hosted_capabilities() {
  jq -cn '{kind:"review", name:"self-hosted", implemented:false, verified:false, needs_env:[], needs_cmd:[], supports:[],
    reason:"self-hosted reviewer prompt not implemented; use review=greptile or build factory/commands/review.md"}'
}
