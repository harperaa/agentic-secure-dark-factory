#!/usr/bin/env bash
# payments/payone — refused until the SVCOS `payments-payone` optional module exists (design R14).
# See payments/mollie.sh for the reasoning and docs/upstream/svcos-modules.md for the proposal.

payments_payone_capabilities() {
  jq -cn '{kind:"payments", name:"payone", implemented:false, verified:false, needs_env:[], needs_cmd:[], supports:[],
    reason:"requires the SVCOS optional module payments-payone (design R14); EU profile ships with Clerk Billing until it lands"}'
}
