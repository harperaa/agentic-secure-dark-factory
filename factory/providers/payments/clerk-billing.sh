#!/usr/bin/env bash
# payments/clerk-billing — Clerk Billing + Stripe, SVCOS's built-in pricing module. Default profile.
# Genesis performs no payments work (Stripe is a human gate, design §9); the adapter exists so the
# profile gate can name what a project uses and refuse what it cannot.

payments_clerk_billing_capabilities() {
  jq -cn '{kind:"payments", name:"clerk-billing", implemented:true, verified:true,
    needs_env:[], needs_cmd:[], supports:[], human_gate:"Stripe account and Clerk Billing are provisioned by a person (design §9)"}'
}
