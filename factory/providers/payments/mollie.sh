#!/usr/bin/env bash
# payments/mollie — refused until the SVCOS `payments-mollie` optional module exists (design R14).
# SVCOS's pricing/subscription module is Clerk Billing-specific; swapping it needs template code,
# which the factory will not patch (design G7). See docs/upstream/svcos-modules.md.

payments_mollie_capabilities() {
  jq -cn '{kind:"payments", name:"mollie", implemented:false, verified:false, needs_env:[], needs_cmd:[], supports:[],
    reason:"requires the SVCOS optional module payments-mollie (design R14); EU profile ships with Clerk Billing until it lands"}'
}
